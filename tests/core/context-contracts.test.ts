import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {SessionEvent, UserMessage} from '@deepseek-ai/dsh-session';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {renderContextSections} from '@deepseek-ai/dsh-system-prompt';
import {resolveCompanionHome} from '../../src/core/companion-foundation.js';
import {INTERACTION_CONTEXT} from '../../src/core/interaction-presentation.js';
import {createChannelHomes} from '../../src/channels/sessions.js';
import {GUEST_PRESET} from '../../src/channels/guest.js';
import {RoomChat} from '../../src/room/chat.js';

// The Cordis fixture is shared with the JavaScript gate tests in the source tree.
const {cordisFixture, eventually} = await import(new URL('../../../tests/behavior-list/entries-lifecycle.test.mjs',import.meta.url).href);
type Section = {name:string; text:string};
type Call = {agent:Agent; messages:UserMessage[]; schemas:string[]; sections:Section[]; system:string};
const interaction = (sections:Section[]) => sections.find(row=>row.name==='chatpet.interactions');
const views = (agent:Agent) => agent.session.surface.nodes.map(seq=>agent.session.eventAt(seq));
const sectionNames = (event:SessionEvent|undefined) =>
  event?.type==='user/message' && event.data.source.kind==='runtime-context' && event.data.source.form==='snapshot' ? event.data.source.sections.map(row=>row.name) : [];

test('真实 Life 输入在首次模型 schema 解析前已安装工具限制',async t=>{
  const f = await cordisFixture(t);
  await f.enable();
  const first:Call = await eventually(()=>f.calls.find((call:Call)=>call.messages.some(input=>input.source.kind==='dsh-world-life')),'Life 唤醒进入模型');
  assert.equal(first.agent.id,f.life.homeSessionId());
  assert.ok(first.schemas.includes('life_plan_update'));
  for (const blocked of ['bash','read','write']) assert.ok(!first.schemas.includes(blocked),blocked);
  await first.agent.whenIdle();
  const foreground:Call = await f.input('Owner resumes normal chat.',first.agent.id);
  for (const allowed of ['bash','read','write']) assert.ok(foreground.schemas.includes(allowed),allowed);
});

test('环境准备过程中作用域失效会同时丢弃环境和互动段',async t=>{
  const f = await cordisFixture(t);
  const agent:Agent = await f.agent();
  await f.body.act(f.id,'water','scope-water','desktop');
  const assemble = async()=>renderContextSections(await f.ctx.systemPrompt.assemble({agent,scope:agent}));
  assert.ok(interaction(await assemble()),'先准备有效的互动快照');
  const original = f.body.pendingFacts.bind(f.body);
  const fault = t.mock.method(f.body,'pendingFacts',async (id:string)=>{
    const facts = await original(id);
    f.registry.archivedSessionIds.push(agent.id);
    return facts;
  });
  const invalid = await assemble();
  assert.ok(!invalid.some(row=>row.name==='chatpet.environment'));
  assert.equal(interaction(invalid),undefined);
  fault.mock.restore();
  f.registry.archivedSessionIds.pop();
  assert.ok(interaction(await assemble()),'失效期间原回执仍待确认');
});

test('环境先准备事实且单个领域读取失败保留另一领域事实',async t=>{
  const f = await cordisFixture(t);
  const agent:Agent = await f.agent();
  await f.body.act(f.id,'water','domain-water','desktop');
  await f.ownerAction({kind:'grant',amount:10},'domain-grant');
  for(const [service, surviving] of [[f.body,'economy'],[f.economy,'body']] as const) {
    const fault=t.mock.method(service,'pendingFacts',async()=>{throw Error('Synthetic domain read failure');});
    try {
      const sections:Section[]=renderContextSections(await f.ctx.systemPrompt.assemble({agent,scope:agent}));
      const env=sections.findIndex(row=>row.name==='chatpet.environment'), facts=sections.findIndex(row=>row.name==='chatpet.interactions');
      assert.ok(env>=0 && facts>env);
      assert.deepEqual(JSON.parse(sections[facts].text).facts.map((item:{domain:string})=>item.domain),[surviving]);
    } finally { fault.mock.restore(); }
  }
});

test('原生互动确认按段名和逐条投影匹配落盘快照',async t=>{
  const f = await cordisFixture(t);
  await f.body.act(f.id,'water','projection-water','desktop');
  const [fact]=await f.body.pendingFacts(f.id);
  const expected = {id:fact.id,domain:'body',type:fact.type,at:fact.occurredAt,actor:fact.actor,
    status:fact.result.status,summary:fact.result.summary,...(fact.operationId?{operationId:fact.operationId}:{})};
  assert.equal(INTERACTION_CONTEXT,'chatpet.interactions');
  for(const mutate of [
    (row:Section)=>({...row,name:'fixture.renamed'}),
    (row:Section)=>({...row,text:JSON.stringify({facts:[{...expected,summary:'Different observed result'}]})}),
  ]) {
    f.snapshot=(rows:Section[])=>rows.map(row=>row.name===INTERACTION_CONTEXT?mutate(row):row);
    const call:Call=await f.input('Inspect the current result.');
    assert.deepEqual(JSON.parse(interaction(call.sections)!.text).facts,[expected]);
    assert.deepEqual(await f.body.pendingFacts(f.id),[fact]);
  }
  f.snapshot=(rows:Section[])=>rows.map(row=>row.name===INTERACTION_CONTEXT?{...row,text:JSON.stringify({facts:[
    Object.fromEntries(Object.entries(expected).reverse()),
  ]},null,2)}:row);
  await f.input('Inspect the original result.');
  await eventually(async()=>!(await f.body.pendingFacts(f.id)).length,'原投影落盘后确认');
  assert.deepEqual(await f.body.readFacts(f.id,[fact.id]),[fact]);
});

test('请求内退休旧环境与召回且落盘原文、系统提示、计划和回执保留',async t=>{
  const f = await cordisFixture(t);
  f.model = async ({agent}:Call) => {
    // Stand in for one prior memory result without starting a Memory daemon.
    agent.session.append('user/message',createUserMessage({source:{kind:'chatpet-recall',form:'recall',bank:'synthetic'},
      content:[{type:'text',text:'Previous recall original'}]}),{surfaceOp:'append'});
    return 'First reply';
  };
  const draft={goal:'Keep resting',reason:'Continue the accepted plan',steps:[{id:'rest',kind:'hold',activity:'Rest quietly'}],nextConsiderAt:null};
  await f.life.updatePlan(f.id,0,draft);
  const originalPlan=await f.life.readPlan(f.id);
  const first:Call=await f.input('Continue resting.');
  const original:SessionEvent[]=JSON.parse(readFileSync(f.logFile(first.agent.id),'utf8')).events;
  const oldSnapshot=original.find(event=>sectionNames(event).includes('chatpet.environment'));
  const oldRecall=original.find(event=>event.type==='user/message' && event.data.source.kind==='chatpet-recall');
  assert.ok(oldSnapshot && oldRecall);
  assert.ok(first.sections.some(row=>row.name==='chatpet.environment' && row.text.includes(originalPlan.plan.id)));
  await f.body.act(f.id,'water','native-water','desktop');
  const [receipt]=await f.body.pendingFacts(f.id);
  assert.ok(views(first.agent).some(event=>event?.seq===oldRecall.seq));
  f.model=async ({agent}:Call)=>{
    const visible = views(agent);
    assert.equal(visible.filter(event=>sectionNames(event).includes('chatpet.environment')).length,1);
    assert.ok(!visible.some(event=>event?.seq===oldRecall.seq || event?.seq===oldSnapshot.seq));
    return 'Second reply';
  };
  const second:Call=await f.input('I am here.');
  assert.equal(second.system,first.system);
  const saved:SessionEvent[]=JSON.parse(readFileSync(f.logFile(second.agent.id),'utf8')).events;
  assert.deepEqual(saved.slice(0,original.length),original);
  const requestStart=saved.findIndex((event,i)=>i>=original.length && event.type==='step/start');
  const requestEnd=saved.findIndex((event,i)=>i>requestStart && event.type==='step/end');
  assert.ok(requestStart>=0 && requestEnd>requestStart);
  for (const event of [oldRecall,oldSnapshot]) assert.ok(saved.slice(requestStart,requestEnd)
    .some(replacement=>replacement.sourceEventSeqs?.includes(event.seq)),`request retired event ${event.seq}`);
  assert.deepEqual(await f.life.readPlan(f.id),originalPlan);
  await eventually(async()=>!(await f.body.pendingFacts(f.id)).length,'回执确认');
  assert.deepEqual(await f.body.readFacts(f.id,[receipt.id]),[receipt]);
  assert.ok(f.core.workspace.runtime.store.all('source').some((source:{locator?:string})=>source.locator?.startsWith('companion-fact:')));
});

test('重启按目录和前缀恢复 guest 与 Room 且拒绝不匹配的 guest 预设',async t=>{
  const f=await cordisFixture(t), signal=new AbortController().signal;
  const identity={channel:'qq',accountId:'fixture',conversationId:'group-42',conversationType:'group',speakerId:'qq:9'} as const;
  const routes=()=>createChannelHomes(f.ctx,f.core,{dataDirectory:join(f.repo,'.chatpet','data','channels'),
    ownerHome:()=>resolveCompanionHome(f.ctx,f.core),identityAllowed:()=>true,ownerIdentity:()=>false,active:()=>true});
  let channel=routes(), room=new RoomChat(f.ctx);
  const guest=await channel.open(identity), directory=guest.session.header.cwd;
  assert.match(guest.id,/^chatpet-guest-[0-9a-f]{64}-/);
  assert.equal(guest.session.header.agentPreset,GUEST_PRESET);
  assert.equal(await f.ctx.sessions.flush(guest.session),true);
  const external=await f.registry.create(directory);
  assert.ok(external.sessionIds.includes(guest.id));
  // Most recent membership in the same directory is not sufficient on its own.
  await external.attachSession('unrelated-guest-session');
  await room.reply(f.id,false,{text:'Room before restart'},'room-before',signal,()=>signal.throwIfAborted());
  const roomId=f.bound.sessionIds.find((id:string)=>id.startsWith('chatpet-room-'));
  assert.match(roomId,/^chatpet-room-[0-9a-f]{24}-1$/);
  assert.equal(f.saved(roomId).header.agentPreset,'standard');
  await room.close();
  channel.stop();
  await f.restart();
  channel=routes();room=new RoomChat(f.ctx);
  try {
    const restored=await channel.open(identity);
    assert.equal(restored.id,guest.id);
    assert.equal(restored.session.header.cwd,directory);
    assert.equal(restored.session.header.agentPreset,GUEST_PRESET);
    assert.notEqual(await f.registry.create(directory),external,'工作区目录从磁盘重新加载');
    assert.deepEqual((await room.history(f.id,()=>signal.throwIfAborted())).messages.map(row=>row.text),['Room before restart','Synthetic reply']);
    assert.deepEqual(f.bound.sessionIds.filter((id:string)=>id.startsWith('chatpet-room-')),[roomId]);
    const wrongPreset=t.mock.method(f.ctx.agentPresets,'composedPreset',()=> 'standard');
    try { await assert.rejects(channel.open(identity),/隔离预设不可用/); }
    finally { wrongPreset.mock.restore(); }
  } finally { await room.close(); channel.stop(); }
});

test('Life 运行、暂停和卸载时前台都打开同一共享 home',async t=>{
  const f=await cordisFixture(t);
  const home=await resolveCompanionHome(f.ctx,f.core);
  await f.enable();
  const running:Call=await eventually(()=>f.calls.find((call:Call)=>call.messages.some(input=>input.source.kind==='dsh-world-life')),'运行时打开 home');
  await home.whenIdle();
  assert.equal(f.life.homeSessionId(),home.id);
  assert.equal(running.agent.id,home.id);
  assert.match(running.system,/当前的自主规划投递会话/);
  await f.life.control(f.id,false);
  assert.equal(f.life.homeSessionId(),undefined);
  assert.equal((await resolveCompanionHome(f.ctx,f.core)).id,home.id);
  assert.doesNotMatch((await f.input('Paused foreground',home.id)).system,/当前的自主规划投递会话/);
  await f.unload('life');
  f.states([true,false,true]);
  assert.equal((await resolveCompanionHome(f.ctx,f.core)).id,home.id);
  assert.doesNotMatch((await f.input('Foreground after unload',home.id)).system,/当前的自主规划投递会话/);
  assert.deepEqual(f.sessionCreateCalls,[home.id]);
});
