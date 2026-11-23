import test from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync} from 'node:fs';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {fixture,signal,until} from './fixture.mjs';
import {footer,assertEmotion,assertObservation,prepareMemory} from './policy-evidence.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=';
const image='data:image/png;base64,'+png;
const setup=(t,options={})=>fixture(t,{policy:true,room:true,emotion:true,life:false,economy:false,...options});
const request=(f,endpoint,data,id='one',caller=signal())=>f.service('petRoom').request('world',endpoint,data,id,caller);
async function incoming(f,pending) {
  let agent;
  await Promise.race([pending,until(()=>{
    agent=f.workspace.sessionIds.filter(id=>id.startsWith('chatpet-room-')).map(f.agent).find(row=>row.inbox.nextTurn.length);
    return agent;
  },'Room 把输入投递给原生会话')]);
  assert.ok(agent,'Room 请求在原生轮次结束前等待');
  return {agent,message:agent.inbox.nextTurn[0],pending};
}
async function privateChat(f,text,id='one') {
  const turn=await incoming(f,request(f,'roomChat',{text},id));
  return {...turn,active:await f.begin(turn.agent.id,turn.message)};
}
async function television(f) {
  const turn=await incoming(f,request(f,'roomTelevision',{image}));
  return {...turn,active:await f.begin(turn.agent.id,turn.message)};
}

test('Room 私聊复用最大未归档编号且同一请求只投递一次，界面回放最近 80 条',async t=>{
  const f=await setup(t);
  assert.deepEqual((await request(f,'roomHistory',{})).messages,[]);
  const owner=await f.begin('owner-b');
  await f.end(owner);
  const first=await privateChat(f,'First Room input');
  assert.match(first.agent.id,/-1$/);
  await f.end(first.active);
  assert.equal((await first.pending).reply,'Synthetic model response');
  const recent=await f.create(first.agent.id.replace(/-1$/,'-10'));
  const archived=await f.create(first.agent.id.replace(/-1$/,'-11'));
  await f.registry.archiveSession(archived);
  const chat=await privateChat(f,'Second Room input','two');
  assert.equal(chat.agent.id,recent);
  assert.equal(chat.message.source.kind,'user');
  assert.equal(f.host.native.isAutonomous(recent),false);
  assert.deepEqual(chat.active.prompt.sections,owner.prompt.sections);
  assert.deepEqual(chat.active.prompt.contexts.map(row=>row.name),owner.prompt.contexts.map(row=>row.name));
  assert.ok(f.schemas(chat.active).includes('room_state'));
  assert.ok(await f.tool(chat.active,'room_state',{}));
  await f.end(chat.active,'completed',footer('Room owner'));
  await chat.pending;
  await assertEmotion(f,'Room owner');
  assert.equal((await request(f,'roomChat',{text:'Second Room input'},'two')).reply,'Synthetic reply');
  assert.equal(f.sent.filter(row=>row.source.rpcId===chat.message.source.rpcId).length,1);
  for(let i=0;i<81;i++)chat.agent.session.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'History '+i}]});
  const history=(await request(f,'roomHistory',{})).messages;
  assert.deepEqual(history.map(row=>row.text),Array.from({length:80},(_,i)=>'History '+(i+1)));
});

test('Room 电视和私聊共用原生日志，电视只准当前画面且所有可见工具均不能执行',async t=>{
  const f=await setup(t,{memory:true});
  await prepareMemory(f);
  const chat=await privateChat(f,'Fixture Room history');
  await f.end(chat.active);
  await chat.pending;
  const tv=await television(f);
  assert.equal(tv.agent.id,chat.agent.id);
  assert.ok(tv.agent.session.snapshotEvents().some(event=>event.type==='user/message'&&event.data.id===chat.message.id));
  assert.equal(tv.message.source.kind,'chatpet-room-tv');
  assert.match(tv.message.content[0].text,/【电视画面】/);
  assert.deepEqual(tv.message.content.slice(1),[{type:'image',mediaType:'image/png',data:png}]);
  const native=f.host.native;
  assert.equal(native.acceptsInput(tv.agent.id,tv.message),true);
  assert.equal(native.acceptsInput(tv.agent.id,{...tv.message,id:'not-the-active-frame'}),false);
  assert.equal(native.acceptsInput('owner-b',tv.message),false);
  assert.equal(native.isAutonomous(tv.agent.id),true);
  const visible=tv.active.prompt.tools.map(tool=>tool.name);
  assert.ok(visible.includes('bash'));
  assert.ok(visible.includes('pet_emotion_update'));
  assert.ok(!visible.some(name=>name.startsWith('room_')));
  for(const name of visible)await assert.rejects(f.tool(tv.active,name,{}),/电视画面只能用于观后感/);
  f.workspace.path=f.root;
  try {
    assert.equal(native.acceptsInput(tv.agent.id,tv.message),false,'绑定变化使在途画面的准入失效');
  } finally {
    f.workspace.path=f.repo;
    await f.end(tv.active);
    await tv.pending;
  }
  assert.equal(native.acceptsInput(tv.agent.id,tv.message),false);
  assert.ok(!(await request(f,'roomHistory',{})).messages.some(row=>row.text.includes('【电视画面】')));
});

test('Room 电视达到自主步数上限，并在自主时限取消原生轮次',async t=>{
  const f=await setup(t,{limits:{maxSteps:1,maxDurationMs:1000}});
  const tv=await television(f);
  await assert.rejects(f.step(tv.active,[tv.message]),/model-step limit/);
  const failure=assert.rejects(tv.pending,/取消|cancellation/);
  await until(()=>f.cancellations.some(row=>row.id===tv.agent.id),'自主时限到点取消 Room 电视',750);
  await f.end(tv.active,'aborted');
  await failure;
});

test('3C 电视接管期间相册 schema 和旧工具均不可用，电视请求收尾后恢复',async t=>{
  const f=await setup(t);
  const chat=await privateChat(f,'Open the album.');
  const name='pet_list_photos';
  const old=chat.agent.ctx.tools.executable(name,chat.agent,chat.active.toolSet);
  assert.ok(old);
  await f.end(chat.active);
  await chat.pending;
  const tv=await television(f);
  assert.ok(!f.schemas(tv.active).includes(name));
  const owner=createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Owner takes over.'}]});
  tv.agent.steer(owner);
  await f.step(tv.active,[owner]);
  assert.ok(!f.schemas(tv.active).includes(name));
  await assert.rejects(f.tool(tv.active,name,{}),/电视画面只能用于观后感/);
  await assert.rejects(old.execute({},{agent:tv.agent,signal:signal()}),/相册需要当前工作区/);
  const emotion=f.service('petEmotion'),before=await emotion.read('world');
  await f.end(tv.active,'completed',footer('Television takeover'));
  assert.equal((await tv.pending).reply,'Synthetic reply');
  assert.deepEqual(await emotion.read('world'),before,'主人接管没有给同一轮电视回复写入授权');
  const next=await f.begin(tv.agent.id);
  assert.ok(f.schemas(next).includes(name));
  assert.equal((await f.tool(next,name,{})).total,0);
  await f.end(next);
});

test('Room 调用方取消会传到原生轮次',async t=>{
  const f=await setup(t);
  const caller=new AbortController();
  const chat=await incoming(f,request(f,'roomChat',{text:'Cancel this turn'},'cancel',caller.signal));
  const active=await f.begin(chat.agent.id,chat.message);
  const failure=assert.rejects(chat.pending,{name:'AbortError'});
  caller.abort();
  assert.deepEqual(f.cancellations,[{id:chat.agent.id,reason:{kind:'user'}}]);
  await f.end(active,'aborted');
  await failure;
});

test('Room 接入及首步恢复会话副本与桌面和房间图片',async t=>{
  const restored=[];
  const f=await setup(t,{desktop:true,configure(services){
    services.set('attachments',{async admitPromptContent(content){restored.push(...content);return content;}});
  }});
  const chat=await privateChat(f,'Portable Room input');
  await f.end(chat.active);
  await chat.pending;
  const tv=await television(f);
  await f.end(tv.active);
  await tv.pending;
  await f.service('petDesktop').features.images.admit({mediaType:'image/png',data:png});
  await f.restart(()=>unlinkSync(f.logFile(chat.agent.id)));
  assert.equal(f.agent(chat.agent.id).session.seq,0,'假宿主重新启动时缺少本机日志');
  restored.length=0;
  const logs=f.service('petTranscripts'),restore=t.mock.method(logs,'restore');
  const after=await privateChat(f,'After Room restart','after');
  assert.equal(after.agent.id,chat.agent.id);
  assert.ok(after.agent.session.snapshotEvents().some(event=>event.type==='user/message'&&event.data.id===chat.message.id));
  assert.equal(restore.mock.callCount(),2,'Room 入口与原生首步均等待恢复');
  assert.deepEqual(restored.map(part=>part.data),[png,png]);
  await f.end(after.active);
  await after.pending;
});

test('Room 私聊与电视按 owner 和伙伴身份进入 Memory',async t=>{
  const f=await setup(t,{memory:true});
  await prepareMemory(f);
  const chat=await privateChat(f,'Synthetic Room owner statement');
  await f.end(chat.active);
  await chat.pending;
  assertObservation(f,chat.agent.id,chat.message.id,'owner_statement','owner');
  const tv=await television(f);
  await f.end(tv.active);
  await tv.pending;
  const frame=assertObservation(f,tv.agent.id,tv.message.id,'virtual_action','fish');
  const reply=assertObservation(f,tv.agent.id,null,'model_interpretation','fish');
  assert.ok(reply.rootSourceIds.includes(frame.sourceId));
});

test('Room 电视回复剥离 footer 且不写共享情绪',async t=>{
  const f=await setup(t);
  const tv=await television(f);
  const emotion=f.service('petEmotion'),before=await emotion.read('world');
  await f.end(tv.active,'completed',footer('Television'));
  assert.equal((await tv.pending).reply,'Synthetic reply');
  assert.deepEqual(await emotion.read('world'),before);
});

test('Room 在途回复重新校验绑定并拒绝旧工作区',async t=>{
  const f=await setup(t);
  const chat=await privateChat(f,'Synthetic input before binding changed');
  const failure=assert.rejects(chat.pending,/房间工作区已切换/);
  f.workspace.path=f.root;
  await f.end(chat.active);
  await failure;
  await assert.rejects(request(f,'roomHistory',{}),/房间工作区已切换/);
});
