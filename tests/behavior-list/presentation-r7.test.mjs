import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryPlugin} from '../../dist/tests/behavior-list/entries.js';
import {lookupLifeOutlet} from '../../dist/src/living/outlets.js';
import {eventually,submitPlan} from './entries-lifecycle.test.mjs';
import {interactionFacts} from './native-facts.mjs';
import {peripherals,presentationFixture,readRpcResult} from './presentation-r7-fixture.mjs';

const services={desktop:'petDesktop',platform:'petPlatform',room:'petRoom',channels:'petChannels',voice:'petVoice'};
const routes={platform:['/chatpet-presentation'],room:['/chatpet-room'],
  channels:['/chatpet-connect/bridge/say','/chatpet-connect/bridge/compact']};
const capabilities={desktop:['desktop.presentation','desktop.body'],room:['desktop.room'],
  channels:['channel.qq'],voice:['voice.speech'],console:['console.operations']};

function resources(f,active) {
  for(const [key,service] of Object.entries(services))assert.equal(Boolean(f.ctx.get(service)),active.has(key),service);
  const registrations=f.core.workspace.runtime.capabilityTable.list();
  for(const [key,ids] of Object.entries(capabilities))for(const id of ids) {
    assert.equal(registrations.filter(row=>row.id===id).length,active.has(key)?1:0,id);
  }
  for(const [key,paths] of Object.entries(routes))for(const path of paths) {
    assert.equal([...f.webRoutes].filter(route=>route.path===path).length,active.has(key)?1:0,path);
  }
  const {toolTable,sourceTable,companionPorts}=f.core.native;
  const policies=sourceTable.policyRows();
  for(const [key,rows] of [['desktop',[7,9]],['room',[8]]]) {
    for(const number of rows)assert.equal(policies.filter(row=>row.row===number).length,active.has(key)?1:0,`策略 ${number}`);
  }
  assert.equal(Boolean(toolTable.getRegistration('room_state')),active.has('room'));
  assert.equal(Boolean(companionPorts.get('watchingTelevision')),active.has('room'));
  for(const key of ['desktop','channels'])assert.equal(Boolean(lookupLifeOutlet(f.ctx,f.core,key)),active.has(key),key);
}

async function chat(f,text,roomActive,sessionId) {
  const call=await f.input(text,sessionId);
  assert.equal(call.schemas.includes('room_state'),roomActive);
  const events=f.saved(call.agent.id).events;
  assert.equal(events.filter(event=>event.type==='assistant/message').at(-1).data.message.content[0].text,'Ordinary reply');
}

test('六个外围入口全关时原生聊天、Memory、身体与钱包仍可用',{timeout:30_000},async t=>{
  const f=await presentationFixture(t,{memory:true});
  await f.ctx.plugin(memoryPlugin);
  for(const key of peripherals)await f.mount(key);
  resources(f,new Set(peripherals));
  const first=await f.agent('owner-a');
  const memory=f.ctx.petMemory;
  await memory.prepare(first.id,f.core.native.nativeScopeFor(first.id));
  f.model=async()=> 'Ordinary reply';
  const {fact}=await f.body.roomAction(f.id,{action:'talk',text:'Synthetic memory note'});
  await chat(f,'What happened in the room?',true,first.id);
  assert.ok(interactionFacts(f.saved(first.id).events).some(row=>row.id===fact.id));
  await eventually(async()=>!(await f.body.pendingFacts(f.id)).length,'Body 事实在原生日志落盘后确认');
  for(const key of [...peripherals].reverse())await f.unmount(key);
  resources(f,new Set());
  f.states([true,true,true]);

  const second=await f.agent('owner-b');
  await chat(f,'What just happened?',false,second.id);
  assert.ok(memory.context(second.id).includes(fact.result.summary),'另一会话从真实 Memory 召回已确认的事实');
  const events=f.saved(second.id).events;
  assert.ok(events.some(event=>event.type==='user/message'&&event.data.source.kind==='chatpet-recall'&&
    event.data.content.some(part=>part.type==='text'&&part.text.includes(fact.result.summary))));
  assert.ok(!interactionFacts(events).some(row=>row.id===fact.id),'召回没有借用待送达队列');
  const {balance}=await f.economy.snapshot(f.id);
  assert.equal((await f.ownerAction({kind:'grant',amount:7},'r7-wallet')).balance,balance+7);
  assert.equal((await f.ownerAction({kind:'grant',amount:7},'r7-wallet')).balance,balance+7);
  assert.equal((await f.economy.snapshot(f.id)).balance,balance+7);
  await f.body.act(f.id,'water','r7-body');
  assert.ok((await f.body.pendingFacts(f.id)).some(row=>row.requestId==='r7-body'));
});

test('反序挂载、逐关和重载六个外围入口时在途生活计划继续且可撤销资源随入口切换',async t=>{
  const f=await presentationFixture(t);
  let submitted=false;
  f.model=async call=>{
    if(!submitted&&call.messages.some(message=>message.source.kind==='dsh-world-life')) {
      submitted=true;
      await submitPlan(call,[{id:'rest',kind:'hold',activity:'Resting',durationMinutes:10}],
        new Date(Date.now()+3_600_000).toISOString());
    }
    return 'Ordinary reply';
  };
  await f.enable();
  const plan=await eventually(async()=>{
    const current=(await f.life.readPlan(f.id)).plan;
    return current?.operationId&&(await f.body.inspectPlanned(f.id,current.operationId))?.status==='running'&&current;
  },'Life 和 Body 以同一编号启动计划');
  const grants=await f.ownerAction({kind:'grant',amount:13},'r7-in-flight-wallet');
  const owner=await f.agent('r7-owner');
  async function checkLiving(label,roomActive) {
    f.states([true,true,true]);
    assert.equal(f.life.running(),true,label);
    assert.equal((await f.life.readPlan(f.id)).plan.operationId,plan.operationId,label);
    assert.equal((await f.body.inspectPlanned(f.id,plan.operationId)).status,'running',label);
    assert.equal((await f.economy.snapshot(f.id)).balance,grants.balance,label);
    await chat(f,label,roomActive,owner.id);
  }
  const active=new Set();
  await checkLiving('All peripherals off',false);
  for(const key of [...peripherals].reverse()) {
    await f.mount(key);
    active.add(key);
    if(key==='platform')resources(f,new Set([...active].filter(name=>name!=='platform')));
  }
  resources(f,active);
  const roomVoices=()=>f.ctx.petRoom.request(f.id,'roomVoice',{operation:'voices'},'r7-voices',new AbortController().signal);
  assert.ok((await roomVoices()).voices.length>1);
  const status=await f.ctx.petChannels.request(f.id,'channelStatus',{});
  assert.equal(status.messaging.config.qq.enabled,false);
  const entered=Promise.withResolvers(),late=Promise.withResolvers();
  await f.ctx.plugin(scope=>scope.provide('speechToText',{
    resolve:()=>({synthetic:true}),listProviders:()=>['fixture'],
    transcribe(_audio,signal) { entered.resolve(signal);return late.promise; },
  }));
  const toolLease=f.core.native.toolTable.getRegistration('room_state').lease;
  for(const key of peripherals) {
    const caller=new AbortController();
    const recording=key==='voice'&&assert.rejects(
      f.ctx.petRoom.request(f.id,'roomVoice',{operation:'hear',payload:{audio:'AA=='}},'r7-voice-late',caller.signal),
      {name:'AbortError'},
    );
    const providerSignal=recording&&await entered.promise;
    await f.unmount(key);
    const remaining=new Set([...active].filter(name=>name!==key&&(key!=='desktop'||name!=='platform')));
    resources(f,remaining);
    if(key==='room')assert.equal(toolLease.isCurrent(),false);
    if(recording) {
      late.resolve({text:'late transcript'});
      await recording;
      assert.equal(providerSignal.aborted,true);
      assert.equal(caller.signal.aborted,false);
      await assert.rejects(roomVoices(),/语音组件尚未启用/);
    }
    await checkLiving(`After removing ${key}`,remaining.has('room'));
    await f.mount(key);
    resources(f,active);
  }
  const freshLease=f.core.native.toolTable.getRegistration('room_state').lease;
  assert.notEqual(freshLease.generation,toolLease.generation);
  assert.ok((await roomVoices()).voices.length>1);
  for(const key of [...peripherals].reverse())await f.unmount(key);
  resources(f,new Set());
  await checkLiving('After removing every peripheral',false);
  const receipt=await f.body.inspectPlanned(f.id,plan.operationId);
  t.mock.timers.setTime(Date.parse(receipt.until)+1);
  assert.equal((await f.body.inspectPlanned(f.id,plan.operationId)).status,'completed');
  await eventually(async()=> (await f.life.readPlan(f.id)).plan?.cursor===1,'Life 消费原完成回执并推进');
});

test('Room 写入后截断回包，重载后凭原号核对 Body 持久回执且只生效一次',async t=>{
  const f=await presentationFixture(t);
  await f.mount('room');
  await f.mount('console');
  const id='room-write-lost-reply',text='Exactly one synthetic Room note';
  const stop=new AbortController(),original=f.body.roomAction.bind(f.body);
  const hook=t.mock.method(f.body,'roomAction',async(...args)=>{
    const value=await original(...args);
    assert.equal(f.persistedRoom(id,text).receipt?.fact.id,value.fact.id);
    stop.abort();
    return value;
  });
  const cancelled=await f.roomAction(id,text,stop.signal);
  hook.mock.restore();
  assert.equal(cancelled.error.code,'CANCELLED');
  const {ownerId,receipt,notes}=f.persistedRoom(id,text);
  assert.equal(receipt.fact.requestId,ownerId);
  assert.equal(receipt.fact.actor.kind,'owner');
  assert.equal(receipt.fact.actor.channel,'room');
  assert.equal(notes.length,1);
  await f.unmount('room');
  await f.unload('body');
  await f.load('body');
  await f.mount('room');
  const replay=await f.roomAction(id,text);
  assert.equal(replay.ok,true);
  assert.deepEqual(replay.value.fact,receipt.fact);
  assert.deepEqual(f.persistedRoom(id,text),{ownerId,receipt,notes});
});

test('Room 在已收到请求但尚未准入写入时取消，Body 没有回执或效果',async t=>{
  const f=await presentationFixture(t);
  await f.mount('room');
  await f.mount('console');
  const id='room-cancel-before-admission',text='Cancelled Room note';
  const stop=new AbortController();
  const request=f.request('roomAction',id,{workspaceId:f.id,data:{action:'talk',text}},stop.signal);
  const decode=request.json.bind(request);
  t.mock.method(request,'json',async()=>{
    const value=await decode();
    stop.abort();
    return value;
  });
  const response=await readRpcResult(await f.dispatch(request),id);
  assert.equal(response.error.code,'CANCELLED');
  const {receipt,notes}=f.persistedRoom(id,text);
  assert.equal(receipt,undefined);
  assert.deepEqual(notes,[]);
  assert.deepEqual(await f.body.pendingFacts(f.id),[]);
});
