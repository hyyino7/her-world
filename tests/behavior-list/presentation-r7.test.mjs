import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {memoryPlugin} from '../../dist/tests/behavior-list/entries.js';
import {lookupLifeOutlet} from '../../dist/src/living/outlets.js';
import {eventually,submitPlan} from './entries-lifecycle.test.mjs';
import {interactionFacts} from './native-facts.mjs';
import {peripherals,presentationFixture,readRpcResult,selectHome} from './presentation-r7-fixture.mjs';

const services={desktop:'petDesktop',platform:'petPlatform',room:'petRoom',channels:'petChannels'};
const routes={platform:['/chatpet-presentation'],room:['/chatpet-room'],
  channels:['/chatpet-connect/bridge/say','/chatpet-connect/bridge/compact']};
const capabilities={desktop:['desktop.presentation','desktop.body'],room:['desktop.room'],
  channels:['channel.qq'],voice:['voice.speech'],console:['console.operations']};

function resources(f,active) {
  for(const [key,service] of Object.entries(services))assert.equal(Boolean(f.ctx.get(service)),active.has(key),service);
  assert.equal(Boolean(f.core.native.voiceTable.lookup(f.ctx)),active.has('voice'),'VoiceTable');
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
  assert.equal(Boolean(companionPorts.roomWindowFor(f.ctx)),active.has('room'));
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
    stop.abort(new Error('synthetic connection closed'));
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

test('Room 已准入但尚未写入时取消，Body 应保持零效果',async t=>{
  const f=await presentationFixture(t);
  await f.mount('room');
  await f.mount('console');
  await f.body.roomState(f.id);
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  await f.ctx.plugin(scope=>scope.provide('petEmotion',{
    read() { entered.resolve();return resume.promise; },
    roomSnapshot() {},
  }));
  const stop=new AbortController();
  const id='room-cancel-before-commit',text='Synthetic note before commit';
  const response=f.roomAction(id,text,stop.signal);
  try {
    await entered.promise;
    assert.equal(f.persistedRoom(id,text).receipt,undefined,'取消时 Body 尚未写入');
    assert.deepEqual(f.persistedRoom(id,text).notes,[]);
    stop.abort();
  } finally {
    resume.resolve();
  }
  assert.equal((await response).error.code,'CANCELLED');
  const {receipt,notes}=f.persistedRoom(id,text);
  assert.deepEqual({hasReceipt:Boolean(receipt),effects:notes.length},{hasReceipt:false,effects:0});
});


test('Room 回到 A 后丢弃旧 A 的读写和通知，新窗口只接收当前代次',async t=>{
  const f=await presentationFixture(t,{order:['body']});
  await f.mount('room');
  await f.mount('console');
  await f.body.roomState(f.id);
  const secondPath=realpathSync(mkdtempSync(join(tmpdir(),'her-world-room-b-')));
  t.after(()=>rmSync(secondPath,{recursive:true,force:true}));
  const second=await f.registry.create(secondPath);
  const select=target=>selectHome(f,target);
  const window=f.ctx.petRoom.window, messages=[];
  const receive=t.mock.method(window,'send',message=>messages.push(message));
  const openFixture=bound=>Object.assign(window,{bound,loaded:true,lifetime:new AbortController(),
    child:{stdin:{end() {}},once() {},exitCode:0}});
  t.after(()=>{window.closeWindow();receive.mock.restore();});
  const first=f.core.workspace.homeScope();
  openFixture(first);

  const entered=Promise.withResolvers(), resume=Promise.withResolvers();
  await f.ctx.plugin(scope=>scope.provide('petEmotion',{
    async read() {entered.resolve();await resume.promise;}, roomSnapshot() {},
  }));
  const id='room-stale-a',text='Old A synthetic note';
  const writing=f.roomAction(id,text);
  const reading=f.dispatch(f.request('roomState','read-before-switch',{workspaceId:f.id,data:{}}))
    .then(response=>readRpcResult(response,'read-before-switch'));
  let current;
  try {
    await entered.promise;
    assert.equal(f.persistedRoom(id,text).receipt,undefined);
    const other=await select(second);
    assert.notEqual(other.storageId,first.storageId);
    assert.equal(window.status().running,false);
    current=await select(f.bound);
    assert.equal(current.storageId,first.storageId);
    assert.equal(current.path,first.path);
    assert.notEqual(current.generation,first.generation);
    assert.deepEqual(messages,[]);
    openFixture(current);
    f.ctx.emit('world.changed',{...first,bodyOnly:true});
  } finally {resume.resolve();}
  assert.equal((await writing).error?.code,'STALE_BINDING');
  assert.equal((await reading).error?.code,'STALE_BINDING');
  assert.deepEqual(f.persistedRoom(id,text).notes,[]);
  assert.equal(f.persistedRoom(id,text).receipt,undefined);
  assert.deepEqual(messages,[]);

  const fresh=await f.roomAction(id,'Current A synthetic note');
  assert.equal(fresh.ok,true,JSON.stringify(fresh));
  assert.equal(f.persistedRoom(id,'Current A synthetic note').notes.length,1);
  const {bootId,revision}=fresh.value.behavior;
  assert.ok(messages.some(message=>message.type==='changed'&&message.change.bootId===bootId&&message.change.revision===revision));
  await select(second);
  const b=await f.ctx.petRoom.request(second.id,'roomState',{},'read-current-b',new AbortController().signal);
  assert.ok(!JSON.stringify(b).includes('synthetic note'));
});


test('Room 和 Console 兼容回包保留同一活动的播放描述',async t=>{
  const f=await presentationFixture(t);
  await f.mount('room');
  await f.mount('console');
  const request=async(endpoint,data={})=>{
    const requestId=randomUUID();
    const input={workspaceId:f.id,...data};
    const result=await readRpcResult(await f.dispatch(f.request(endpoint,requestId,input)),requestId);
    assert.equal(result.ok,true,JSON.stringify(result));
    return result.value;
  };
  const semantic=await f.body.roomState(f.id);
  assert.ok(semantic.behavior.bootId);
  assert.equal(Object.hasOwn(semantic,'playback'),false);
  const room=await request('roomState',{data:{}});
  const life=await request('lifeView');
  assert.deepEqual(life.home.playback,room.playback);
  assert.equal(room.playback.version,1);
  assert.equal(typeof room.playback.segments[0].roomClip,'string');
  assert.equal(typeof room.playback.segments[0].desktopClip,'string');
  const action=await request('roomAction',{data:{action:'talk',text:'Synthetic compatibility note'}});
  assert.equal(action.home.playback.phase,action.home.behavior.phase);
  const care=await request('lifeAction',{action:'water'});
  assert.equal(care.home.playback.phase,care.home.behavior.phase);
});

async function desktopFeedingFixture(t) {
  const f=await presentationFixture(t);
  await f.mount('desktop');
  await f.mount('platform');
  const request=(path,method='GET',data,signal=new AbortController().signal)=>f.ctx.petPlatform.handle(
    new URL('/chatpet-presentation/'+path,'http://fixture.invalid'),method,data&&JSON.stringify(data),signal);
  const config=await request('config');
  const pet=config.obj.main.bodyTemplate;
  assert.ok(pet,'从真实配置入口取得形象模板');
  assert.equal((await request('config','PUT',{pets:[{...pet,display:'web'}]})).status,200);
  await request('config-live');
  assert.equal((await f.body.roomState(f.id)).behavior.busy,false);
  return Object.assign(f,{
    request,
    feed:(requestId,signal,name='吃饭团')=>request('anim?pet=main&surface=web','POST',{name,requestId},signal),
    effects:async (...ids)=>(await f.body.pendingFacts(f.id)).filter(fact=>fact.type==='feed'&&ids.includes(fact.requestId)),
  });
}

test('桌宠原入口装载后，吃饭请求应能调用已注册的 Body',async t=>{
  const f=await desktopFeedingFixture(t);
  const id='desktop-feed-entry';
  const response=await f.feed(id,undefined,' 吃饭团 ');
  assert.equal(response.status,200);
  assert.equal(response.obj.admission,'started');
  assert.ok(response.obj.playbackId);
  assert.equal((await f.effects(id)).length,1);
});

test('桌宠两个并发吃饭请求只在 Body 投喂一次',async t=>{
  const f=await desktopFeedingFixture(t);
  const ids=['desktop-feed-a','desktop-feed-b'];
  const replies=await Promise.all(ids.map(id=>f.feed(id)));
  assert.deepEqual(replies.map(reply=>reply.status),[200,200]);
  assert.deepEqual(replies.map(reply=>reply.obj.admission).sort(),['already-presented','started']);
  assert.equal((await f.effects(...ids)).length,1);
});

test('桌宠不在伙伴到达主人指定位置的停留期间投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  const ordered=await f.body.roomAction(f.id,{action:'command',room:'her_room',spot:'bedside'},'主人');
  assert.equal(ordered.changed,true);
  const route=f.body.binding.room.state.route;
  assert.ok(route);
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+1);
  const before=await f.body.roomState(f.id);
  assert.deepEqual([before.her.kind,before.her.busy],['idle',true]);
  const ids=['wait-feed-1','wait-feed-2'];
  const responses=await Promise.all(ids.map(id=>f.feed(id)));
  assert.deepEqual(responses.map(reply=>reply.obj.reason),['activity-busy','activity-busy']);
  assert.deepEqual(await f.effects(...ids),[]);
});

test('桌宠吃饭请求在 Body 准入读取时取消，保持零投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  t.mock.method(f.body,'refreshEmotion',()=>{
    entered.resolve();
    return resume.promise;
  });
  const stop=new AbortController(),id='desktop-feed-cancelled';
  const reply=assert.rejects(f.feed(id,stop.signal),{name:'AbortError'});
  try {
    await entered.promise;
    stop.abort();
  } finally {resume.resolve();}
  await reply;
  assert.deepEqual(await f.effects(id),[]);
});

test('桌宠吃饭准入读失败时，Body 不按旧空闲状态投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  await f.body.startPlanned(f.id,{operationId:'desktop-busy-hold',kind:'hold',activity:'Resting',
    until:new Date(Date.now()+60_000).toISOString()});
  assert.equal((await f.body.roomState(f.id)).behavior.busy,true);
  const read=t.mock.method(f.body,'refreshEmotion',async()=>{throw Error('Synthetic Body read failure');});
  const id='desktop-feed-read-failed';
  await assert.rejects(f.feed(id),/Synthetic Body read failure/);
  read.mock.restore();
  assert.deepEqual(await f.effects(id),[]);
});

test('桌宠投喂提交后取消，重载后在新活动中按原号核对',async t=>{
  const f=await desktopFeedingFixture(t);
  const stop=new AbortController(),id='desktop-feed-committed';
  const original=f.body.presentFeed.bind(f.body);
  const hook=t.mock.method(f.body,'presentFeed',async(...args)=>{
    const result=await original(...args);
    assert.equal(result.fact?.requestId,id);
    stop.abort();
    return result;
  });
  await assert.rejects(f.feed(id,stop.signal),{name:'AbortError'});
  hook.mock.restore();
  const [originalFact]=await f.effects(id);
  await f.unmount('platform');
  await f.unload('body');
  t.mock.timers.tick(13_000);
  await f.load('body');
  await f.mount('platform');
  await f.body.act(f.id,'water','desktop-retry-conflict');
  assert.equal((await f.body.roomState(f.id)).her.kind,'drink');
  const replay=await f.feed(id);
  assert.equal(replay.status,200);
  assert.deepEqual(replay.obj,{ok:true,requestId:id,admission:'replayed',effect:originalFact.result.status});
  assert.deepEqual(await f.effects(id),[originalFact]);
  await assert.rejects(f.feed('desktop-retry-conflict'),/同一互动请求不能用于不同内容/);
});

test('桌宠同号查到原播放编号并在移除桌宠后核对已提交的投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  const id='desktop-feed-with-playback';
  const first=await f.feed(id);
  assert.equal(first.obj.admission,'started');
  assert.ok(first.obj.playbackId);
  const [fact]=await f.effects(id);
  const expected={ok:true,requestId:id,admission:'replayed',effect:fact.result.status,playbackId:first.obj.playbackId};
  const ordinary=(await f.feed(id)).obj;
  const animations=(await f.request('config')).obj.main.animations;
  const configFile=(await f.request('config/meta')).obj.user;
  const saved=JSON.parse(readFileSync(configFile,'utf8'));
  const withoutFeed=names=>names.map(name=>name==='吃饭团'?'开心小跑':name);
  saved.animations={...animations,baifan:withoutFeed(animations.baifan),
    categories:animations.categories.map(category=>({...category,actions:withoutFeed(category.actions)}))};
  writeFileSync(configFile,JSON.stringify(saved));
  assert.equal((await f.feed('desktop-feed-missing-clip-new')).obj.reason,'unknown-animation');
  const missingClip=(await f.feed(id)).obj;
  assert.equal((await f.request('config','PUT',{pets:[]})).status,200);
  const removed=(await f.feed(id)).obj;
  assert.deepEqual([ordinary,missingClip,removed],[expected,expected,expected]);
  assert.equal((await f.feed('desktop-feed-removed-new')).obj.reason,'unknown-pet');
  assert.deepEqual(await f.effects(id,'desktop-feed-missing-clip-new','desktop-feed-removed-new'),[fact]);
});

test('桌宠在 Body 缺席时拒绝吃饭，重新挂载后恢复准入',async t=>{
  const f=await desktopFeedingFixture(t);
  await f.unload('body');
  assert.equal((await f.feed('desktop-no-body')).obj.reason,'body-unavailable');
  await f.load('body');
  assert.equal((await f.feed('desktop-no-body')).obj.admission,'started');
  assert.equal((await f.effects('desktop-no-body')).length,1);
});

test('桌宠吃饭准入在 A 回到 A 后拒绝旧请求',async t=>{
  const f=await desktopFeedingFixture(t);
  const secondPath=realpathSync(mkdtempSync(join(tmpdir(),'her-world-feed-b-')));
  t.after(()=>rmSync(secondPath,{recursive:true,force:true}));
  const second=await f.registry.create(secondPath), first=f.core.workspace.homeScope();
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  const read=t.mock.method(f.body,'refreshEmotion',()=>{
    entered.resolve();
    return resume.promise;
  });
  const id='desktop-feed-stale';
  const old=assert.rejects(f.feed(id),/工作区或身体组件已切换|身体工作区已切换|AbortError/);
  try {
    await entered.promise;
    await selectHome(f,second);
    const current=await selectHome(f,f.bound);
    assert.equal(current.storageId,first.storageId);
    assert.notEqual(current.generation,first.generation);
  } finally {resume.resolve();}
  await old;
  read.mock.restore();
  assert.deepEqual(await f.effects(id),[]);
  assert.equal((await f.feed(id)).obj.admission,'started');
  assert.equal((await f.effects(id)).length,1);
});

test('桌宠投喂写入前复核占用锁，已提交结果仍可按原号核对',async t=>{
  const f=await desktopFeedingFixture(t);
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  const read=t.mock.method(f.body,'refreshEmotion',()=>{
    entered.resolve();
    return resume.promise;
  });
  const id='desktop-feed-lock-race';
  const reply=f.feed(id);
  const lock=()=>f.request('lock?pet=main&surface=web','POST',{});
  let lockId;
  try {
    await entered.promise;
    const response=await lock();
    assert.equal(response.obj.ok,true);
    lockId=response.obj.lockId;
  } finally {resume.resolve();}
  const blocked=await reply;
  read.mock.restore();
  assert.equal(blocked.status,200);
  assert.equal(blocked.obj.reason,'lock-required');
  assert.deepEqual(await f.effects(id),[]);
  assert.equal((await f.request('lock/release?pet=main','POST',{lockId})).obj.ok,true);
  assert.equal((await f.feed(id)).obj.admission,'started');
  assert.equal((await lock()).obj.ok,true);
  assert.equal((await f.feed(id)).obj.admission,'replayed');
  assert.equal((await f.effects(id)).length,1);
});

test('Console 卸载后实际请求应找不到 Connection 路由',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  const request=id=>f.request('foundation',id,{workspaceId:f.id});
  const before=await readRpcResult(await f.dispatch(request('before-unload')),'before-unload');
  assert.equal(before.ok,true,JSON.stringify(before));
  await f.unmount('console');
  const status=await f.dispatch(request('after-unload')).then(response=>response.status,error=>error.message);
  assert.equal(status,404,'卸载后的请求应在 Connection 路由层结束');
  assert.equal(f.rpcRoutes.size,0);
});

test('Console 重载后 Connection 对同一路由应只登记一次',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  assert.equal(f.rpcCount('foundation'),1);
  await f.unmount('console');
  await f.mount('console');
  assert.equal(f.rpcCount('foundation'),1,'重载后应只登记一次基础档案路由');
  assert.equal((await readRpcResult(await f.dispatch(f.request('foundation','after-reload',{workspaceId:f.id})),'after-reload')).ok,true);
});

test('Console 旧外观设置在 Desktop 缺席、挂载和卸载时都可读', async t => {
  const f = await presentationFixture(t);
  const config = join(f.repo, '.chatpet/core.json');
  const before = JSON.parse(readFileSync(config, 'utf8'));
  const old = {position: {corner: 'bottom-right', marginX: 24, marginY: 30}};
  writeFileSync(config, JSON.stringify({...before, companion: {desktopAppearance: old}}));
  await f.mount('console');
  const rpc = async (endpoint, id, input = {}) => readRpcResult(await f.dispatch(f.request(endpoint, id, input)), id);
  const without = await rpc('snapshot', 'without-desktop');
  assert.equal(without.ok, true, JSON.stringify(without));
  assert.equal(without.value.desktop, null);
  assert.deepEqual(without.value.companion.desktopAppearance, old);
  assert.equal(without.value.companion.recentMoodHours, null);
  assert.equal((await rpc('desktopOpen', 'unavailable', {workspaceId: f.id})).error.code, 'UNAVAILABLE');
  await f.mount('desktop');
  const withDesktop = await rpc('snapshot', 'with-desktop');
  assert.equal(typeof withDesktop.value.desktop.running, 'boolean');
  assert.deepEqual(withDesktop.value.companion.desktopAppearance, old);
  await f.unmount('desktop');
  const afterUnload = await rpc('snapshot', 'again-without-desktop');
  assert.equal(afterUnload.value.desktop, null);
  assert.deepEqual(afterUnload.value.companion.desktopAppearance, old);
});

test('Console 丢弃卸载前的迟到回包并透传结构化设置错误', async t => {
  const f = await presentationFixture(t);
  await f.mount('console');
  const entered = Promise.withResolvers(), finish = Promise.withResolvers();
  const save = t.mock.method(f.core.services.workspace, 'saveCompanion', async () => {
    entered.resolve();
    return finish.promise;
  });
  const settings = f.core.workspace.companionConfiguration();
  const input = {workspaceId: f.id, expectedSettings: settings, settings};
  const dispatch = async id => readRpcResult(await f.dispatch(f.request('companion', id, input)), id);

  const late = dispatch('late-before-unload');
  try {
    await entered.promise;
    await f.unmount('console');
    await f.mount('console');
  } finally {
    finish.resolve({ok: true, value: settings});
  }
  const reply = await late;
  assert.deepEqual(reply, {ok: false, error: {code: 'CANCELLED', message: '请求已取消，请刷新核对实际保存结果。',
    details: {}, effect: 'unknown', retry: 'reconcile'}});
  save.mock.mockImplementation(async () => ({ok: false, error: {code: 'UNAVAILABLE', message: 'owner detail',
    effect: 'partial', retry: 'reconcile'}}));
  const rejected = await dispatch('forward-structured-error');
  assert.deepEqual(rejected, {ok: false, error: {code: 'UNAVAILABLE', message: '00-Core 尚未就绪，请检查核心模块是否启用。',
    details: {}, effect: 'partial', retry: 'reconcile'}});
  save.mock.restore();
  assert.equal((await dispatch('current-after-reload')).ok, true);
});
