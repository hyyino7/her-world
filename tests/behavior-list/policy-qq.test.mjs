import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {fixture,until} from './fixture.mjs';
import {qqTransport} from './qq-transport.mjs';
import {assertEmotion,assertObservation,footer,nextReview,prepareMemory} from './policy-evidence.mjs';

async function setup(t,options={}){
  const transport=qqTransport(t);
  const f=await fixture(t,{policy:true,emotion:true,channels:true,economy:false,life:false,...options});
  const channels=f.service('petChannels'),status=await channels.request('world','channelStatus',{});
  await channels.request('world','messagingSettings',{expected:status.messaging.config,next:{
    qq:{enabled:true,accountId:'100',ownerSpeakerId:'200',allowPrivate:['200','300']},
  }});
  assert.ok(transport.gateway,'真实渠道已挂上合成 SDK 传输');
  function send(userId,messageId,text) {
    transport.gateway.onPrivateMessage({kind:'private',selfId:'100',userId,messageId,text});
  }
  function queued(messageId){
    for(const id of f.workspace.sessionIds) {
      const agent=f.agent(id);
      const message=agent.inbox.nextTurn.find(row=>row.source.identity?.platformMessageId===messageId);
      if(message)return {agent,message};
    }
  }
  async function receive(messageId,agents) {
    const delivered=()=>agents?agents().flatMap(agent=>agent.inbox.nextTurn.map(message=>({agent,message})))
      .find(row=>row.message.source.identity?.platformMessageId===messageId):queued(messageId);
    await until(delivered,'QQ 收件进入原生 inbox');
    return delivered();
  }
  return {f,send,receive,transport};
}

test('QQ 主人私聊进 home，同一收件可重查且不能授权另一消息',async t=>{
  const {f,send,receive,transport}=await setup(t,{memory:true,limits:{maxSteps:1,maxToolCalls:0}});
  const home=await f.home();
  await prepareMemory(f,home.id);
  send('200','owner-receipt','Synthetic QQ owner statement');
  const {agent,message}=await receive('owner-receipt');
  assert.equal(agent.id,home.id);
  const accept=word=>f.host.native.acceptsInput(home.id,word);
  assert.equal(accept(message),true);
  assert.equal(accept(message),true);
  assert.equal(accept({...message,id:'another-native-message'}),false);
  const active=await f.begin(home.id,message);
  assert.equal(f.host.native.isAutonomous(home.id),false);
  assert.ok(f.schemas(active).includes('bash'));
  assert.equal(await f.tool(active,'bash',{}),'bash');
  await f.step(active);
  assert.equal(await f.tool(active,'bash',{}),'bash');
  await f.end(active,'completed',footer('QQ owner'));
  assert.equal(accept(message),false,'turn/end 清除收件授权');
  await until(()=>transport.sent.length===1,'QQ 回复送达');
  await assertEmotion(f,'QQ owner');
  const identity=message.source.identity;
  assert.equal(identity.channel,'qq');
  assert.equal(identity.speakerId,'qq:200');
  assertObservation(f,home.id,message.id,'owner_statement','owner',identity);
});

test('guest 预设屏蔽继承和晚登记工具，仅组装公开角色卡、身份、情绪与召回',async t=>{
  const {f,send,receive,transport}=await setup(t,{memory:true});
  await prepareMemory(f);
  const query='FIXTURE_SUNFLOWER';
  writeFileSync(join(f.repo,'.chatpet/USER.md'),'Synthetic private owner profile');
  const owner=await f.begin('home',createUserMessage({source:{kind:'user'},content:[{type:'text',text:query+' grows in my garden.'}]}));
  assert.match(owner.prompt.sections.find(row=>row.name==='chatpet.profile').text,/Synthetic private owner profile/);
  assert.ok(f.schemas(owner).includes('pet_emotion_update')&&f.schemas(owner).includes('pet_memory_recall'));
  await f.end(owner);
  f.registerTool('late_fixture_tool');
  const ownerAfter=await f.begin();
  assert.ok(f.schemas(ownerAfter).includes('late_fixture_tool'));
  await f.end(ownerAfter);
  send('300','guest-receipt','Where did '+query+' grow?');
  const {agent,message}=await receive('guest-receipt',()=>f.agents());
  assert.match(agent.id,/^chatpet-guest-/);
  const active=await f.begin(agent.id,message);
  assert.deepEqual(active.prompt.tools,[]);
  assert.deepEqual(active.prompt.sections.filter(row=>row.text.trim()).map(row=>row.name),['deployment:persona-prefix','chatpet.profile','chatpet.expression-guide']);
  assert.match(active.prompt.sections[0].text,/正在外部聊天/);
  assert.equal(active.prompt.sections[1].text,f.host.native.context().identity);
  assert.deepEqual(active.prompt.contexts.map(row=>row.name),['chatpet.expression-state']);
  const recall=active.injections.find(row=>row.source.kind==='chatpet-recall');
  assert.match(recall?.content[0].text??'',/FIXTURE_SUNFLOWER/);
  await f.end(active);
  await until(()=>transport.sent.length===1);
  assertObservation(f,agent.id,message.id,'external_content','qq:300',message.source.identity);
  send('300','guest-followup','Synthetic guest followup');
  const followup=await receive('guest-followup',()=>f.agents());
  assert.equal(followup.agent.id,agent.id);
  assert.ok(agent.session.snapshotEvents().some(event=>event.type==='user/message'&&event.data.id===message.id));
  await f.end(await f.begin(agent.id,followup.message));
  await until(()=>transport.sent.length===2);
});

test('guest 回复剥离 footer，混入其他来源也不写共享情绪',async t=>{
  const {f,send,receive,transport}=await setup(t);
  const emotion=f.service('petEmotion');
  const before=await emotion.read('world');
  const kind='synthetic-footer-source';
  const registration=f.host.native.sourceTable.register({id:kind,order:0,sources:[kind],
    branches:{owner:{turnKind:'foreground',toolSource:'owner',toolPolicy:null,memoryObservation:null,
      emotionUpdate:{footer:true,tool:false}}},
    admit:()=>({kind:'accepted',branch:'owner',context:{policyKey:kind}}),
  });
  t.after(()=>registration.revoke());
  for(const [index,mixed] of [false,true].entries()) {
    const id='guest-emotion-'+index;
    send('300',id,'Synthetic guest input');
    const {agent,message}=await receive(id,()=>f.agents());
    const active=await f.begin(agent.id,message);
    if(mixed) {
      const other=createUserMessage({source:{kind},content:[{type:'text',text:'Synthetic second source'}]});
      await f.step(active,[other]);
    }
    await f.end(active,'completed',footer('Guest'));
    await until(()=>transport.sent.length===index+1);
    assert.equal(transport.sent[index].text,'Synthetic reply');
    assert.deepEqual(await emotion.read('world'),before);
  }
});

test('QQ guest 已准入的消息在会话 cwd 或组合预设变化后被拒',async t=>{
  const {f,send,receive}=await setup(t);
  send('300','guest-binding','Synthetic guest input');
  const {agent,message}=await receive('guest-binding',()=>f.agents());
  assert.match(agent.id,/^chatpet-guest-/);
  const active=await f.begin(agent.id,message);
  const admits=()=>f.host.native.acceptsInput(agent.id,message);
  const {cwd,agentPreset}=agent.session.header;
  const presets=f.service('agentPresets');
  try {
    assert.equal(admits(),true);
    agent.session.header.cwd=f.root;
    assert.equal(admits(),false,'会话 cwd 变化后拒绝同一条收件');
    agent.session.header.cwd=cwd;
    assert.equal(admits(),true,'恢复 cwd 后，同一条收件仍可重查');

    const composedPreset=t.mock.method(presets,'composedPreset',()=> 'standard');
    try {
      assert.equal(agent.session.header.agentPreset,agentPreset);
      assert.equal(admits(),false,'会话头保持原预设，组合预设变化即拒绝收件');
    } finally {composedPreset.mock.restore();}
    assert.equal(admits(),true);
  } finally {
    agent.session.header.cwd=cwd;
    await f.end(active);
  }
});

test('QQ 真实收件在 Life 后续步接管，回顾日记和 Memory 来源跨重启保留',async t=>{
  let createSession;
  const {f,send,transport}=await setup(t,{
    now:new Date(2026,10,15,22,59).toISOString(),memory:true,life:true,limits:{maxDurationMs:30_000},
    configure(services){createSession=t.mock.method(services.get('sessionController'),'create');},
  });
  await f.enable();
  const home=await f.home();
  assert.equal(createSession.mock.callCount(),1,'初次打开 home 时创建原生会话');
  await prepareMemory(f,home.id);
  const autonomous=createUserMessage({source:{kind:'dsh-world-life'},content:[{type:'text',text:'Synthetic autonomous work'}]});
  // 在假宿主的空闲通知与 QQ 投递之间调度一次已就绪的 Life 首步。
  // QQ 仍用上游 followup 投递，后续步输入由真实 Life 监听器转换。
  const whenIdle=home.whenIdle.bind(home);
  let life;
  t.mock.method(home,'whenIdle',async()=>{
    await whenIdle();
    if(!life) {
      assert.equal(home.status,'idle');
      home.steer(autonomous);
      life=await f.begin(home.id,autonomous);
    }
  });
  send('200','qq-during-life','Synthetic QQ during Life');
  const inStep=()=>home.inbox.nextStep.find(row=>row.source.identity?.platformMessageId==='qq-during-life');
  await until(inStep,'Life 的真实入队监听器把 QQ 原生投递转为后续步输入');
  const message=inStep();
  assert.equal(f.host.native.isAutonomous(home.id),true);
  assert.ok(!life.prompt.tools.some(row=>row.name==='bash'));
  await assert.rejects(f.tool(life,'bash',{}),/自主生活仅使用当前生活能力/);
  assert.ok(!home.inbox.nextTurn.some(row=>row.id===message.id));
  await f.step(life,[message]);
  assert.equal(f.host.native.isAutonomous(home.id),false);
  assert.equal(await f.tool(life,'bash',{}),'bash');
  await f.end(life);
  await until(()=>transport.sent.length===1);
  assert.equal(home.session.snapshotEvents().filter(event=>event.type==='turn/start').length,1);
  assertObservation(f,home.id,autonomous.id,'virtual_action','fish');
  const review=await nextReview(f,t);
  assert.equal(review.home.id,home.id);
  const day=review.message.source.reviewDay,path=join(f.repo,'.chatpet/diary',day+'.md');
  const writing=await f.begin(home.id,review.message);
  await f.tool(writing,'write',{file_path:path,content:'Synthetic diary after QQ.'});
  await f.end(writing,'completed','Synthetic review recorded in Memory');
  const reviewSource=assertObservation(f,home.id,review.message.id,'virtual_action','fish');
  const reply=assertObservation(f,home.id,null,'model_interpretation','fish');
  assert.ok(reply.rootSourceIds.includes(reviewSource.sourceId));
  assert.equal(reply.text,'Synthetic review recorded in Memory');
  await f.restart();
  assert.equal((await f.home()).id,home.id);
  assert.equal(createSession.mock.callCount(),0,'重启后打开 home 只解析已存在的原生会话');
  assert.equal(readFileSync(path,'utf8'),'Synthetic diary after QQ.');
  await prepareMemory(f,home.id);
  assert.deepEqual(assertObservation(f,home.id,null,'model_interpretation','fish'),reply);
  const memory=f.service('petMemory'),bank=f.host.workspace.storageId();
  const received=assertObservation(f,home.id,message.id,'owner_statement','owner',message.source.identity);
  assert.equal(await memory.connection.validate({sources:[received,reply].map(row=>({id:row.sourceId,revision:'1'})),memories:[]},bank),'eligible');
});

async function channelClose(t,speakerId) {
  const {f,send,receive}=await setup(t);
  send(speakerId,'close-in-flight','Synthetic QQ input before shutdown');
  const {agent,message}=await receive('close-in-flight',()=>f.agents());
  if(speakerId==='200')assert.equal(agent.id,(await f.home()).id);
  else assert.match(agent.id,/^chatpet-guest-/);
  const active=await f.begin(agent.id,message);
  try {
    assert.equal(agent.status,'running');
    assert.equal(f.host.native.acceptsInput(agent.id,message),true);
    assert.deepEqual(f.cancellations,[]);
    await f.service('petChannels').close();
    assert.deepEqual(f.cancellations,[{id:agent.id,reason:{kind:'user'}}]);
    assert.equal(f.host.native.acceptsInput(agent.id,message),false);
  } finally {await f.end(active,'aborted');}
}

test('关闭渠道取消 home 里已准入的 QQ 主人轮次',async t=>channelClose(t,'200'));
test('关闭渠道取消已准入的 QQ guest 轮次',async t=>channelClose(t,'300'));

async function startNudge(t) {
  const scenario=await setup(t);
  const {f,send,receive}=scenario,home=await f.home();
  send('200','nudge-receipt','Synthetic QQ original for retry');
  const {message}=await receive('nudge-receipt');
  await f.end(await f.begin(home.id,message),'completed','');
  const pending=()=>home.inbox.nextTurn.find(row=>row.source.kind==='dsh-world-reply-nudge');
  await until(pending,'QQ 对空回复只发一次原生补答');
  return {...scenario,home,original:message,nudge:pending()};
}

test('QQ 补答重查原消息，同名换绑后旧授权失效',async t=>{
  const {f,home,original,nudge}=await startNudge(t);
  const accept=word=>f.host.native.acceptsInput(home.id,word);
  assert.equal(nudge.source.forMessageId,original.id);
  assert.equal(accept(nudge),true);
  assert.equal(accept(nudge),true);
  assert.equal(accept({...nudge,source:{...nudge.source,forMessageId:'forged-original'}}),false);
  const old=f.host.workspace.status().target;
  const replacement=join(f.root,'same-named-binding');
  mkdirSync(replacement);
  cpSync(join(f.repo,'.chatpet'),join(replacement,'.chatpet'),{recursive:true});
  await f.bind(replacement);
  assert.equal(f.host.workspace.status().target.id,old.id);
  assert.equal(f.host.workspace.status().target.title,old.title);
  assert.equal(f.host.native.nativeScopeFor(home.id),undefined,'同名绑定也不能继续使用旧 home');
  assert.equal(accept(nudge),false);
});

test('QQ 补答在途关闭渠道，晚到回复不能送出',async t=>{
  const {f,home,nudge,transport}=await startNudge(t);
  const active=await f.begin(home.id,nudge);
  const channels=f.service('petChannels'),{messaging}=await channels.request('world','channelStatus',{});
  await channels.request('world','messagingSettings',{expected:messaging.config,next:{qq:{...messaging.config.qq,enabled:false}}});
  assert.equal(f.host.native.acceptsInput(home.id,nudge),false);
  await f.end(active,'completed','Late QQ reply');
  await f.restart();
  assert.deepEqual(transport.sent,[]);
  assert.equal(f.sent.filter(row=>row.source.kind==='dsh-world-reply-nudge').length,1);
});
