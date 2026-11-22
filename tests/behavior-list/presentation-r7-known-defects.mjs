import test from 'node:test';
import assert from 'node:assert/strict';
import {platformPlugin} from '../../dist/tests/behavior-list/entries.js';
import {presentationFixture,readRpcResult} from './presentation-r7-fixture.mjs';

// 第六批 Console 上线前转绿：路由的撤销责任归入口。
const endpoint='desktopAppearance';
test('Console 卸载后实际请求应找不到 Connection 路由',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  const request=id=>f.request(endpoint,id,{});
  const before=await readRpcResult(await f.dispatch(request('before-unload')),'before-unload');
  assert.equal(before.ok,true,JSON.stringify(before));
  await f.unmount('console');
  const status=await f.dispatch(request('after-unload')).then(response=>response.status,error=>error.message);
  assert.equal(status,404,'卸载后的请求应在 Connection 路由层结束');
});

test('Console 重载后 Connection 对同一路由应只登记一次',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  assert.equal(f.rpcCount(endpoint),1);
  await f.unmount('console');
  await f.mount('console');
  assert.equal(f.rpcCount(endpoint),1,'重载重复登记旧路由');
  assert.equal((await readRpcResult(await f.dispatch(f.request(endpoint,'after-reload',{})),'after-reload')).ok,true);
});

// 第三批 Room 上线前转绿：取消必须抵达 Body 提交边界。
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

async function desktopFeedingFixture(t,{declareBody=true}={}) {
  const f=await presentationFixture(t);
  await f.mount('desktop');
  // 其余投喂复现补声明以到达实际 Body 写入，保留原入口的单独红项。
  if(declareBody)await f.ctx.plugin({...platformPlugin,inject:[...platformPlugin.inject,'petBehavior']});
  else await f.mount('platform');
  const platform=f.ctx.petPlatform;
  const request=(path,method='GET',data,signal=new AbortController().signal)=>platform.handle(
    new URL('/chatpet-presentation/'+path,'http://fixture.invalid'),method,data&&JSON.stringify(data),signal);
  const config=await request('config');
  const pet=config.obj.main.bodyTemplate;
  assert.ok(pet,'从真实配置入口取得形象模板');
  const saved=await request('config','PUT',{pets:[{...pet,display:'web'}]});
  assert.equal(saved.status,200);
  await request('config-live');
  const roomState=f.body.roomState.bind(f.body);
  const idle=await roomState(f.id);
  assert.equal(idle.behavior.busy,false);
  return {
    ...f,roomState,idle,request,
    feed:(requestId,signal)=>request('anim?pet=main&surface=web','POST',{name:'吃饭团',requestId},signal),
    effects:async ids=>(await f.body.pendingFacts(f.id)).filter(fact=>fact.type==='feed'&&ids.includes(fact.requestId)).length,
  };
}

test('桌宠原入口装载后，吃饭请求应能调用已注册的 Body',async t=>{
  const f=await desktopFeedingFixture(t,{declareBody:false});
  const id='desktop-feed-entry';
  const outcome=await f.feed(id).then(result=>result.status,error=>error.message);
  assert.equal(outcome,200);
  assert.equal(await f.effects([id]),1);
});

// 第五批 Desktop 上线前转绿：同一空闲并发只投喂一次，取消与读失败不得落盘。
test('桌宠两个并发吃饭请求共用空闲快照时，Body 应只投喂一次',async t=>{
  const f=await desktopFeedingFixture(t);
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  let reads=0;
  t.mock.method(f.body,'roomState',async(...args)=>{
    if(++reads>2)return f.roomState(...args);
    entered.resolve();
    await resume.promise;
    return f.idle;
  });
  const ids=['desktop-feed-a','desktop-feed-b'];
  const replies=Promise.all(ids.map(id=>f.feed(id)));
  await entered.promise;
  resume.resolve();
  const statuses=(await replies).map(reply=>reply.status);
  assert.equal(await f.effects(ids),1,`两个实际请求的响应状态为 ${statuses.join('、')}`);
});

test('桌宠吃饭请求在刷新身体快照时取消，Body 应保持零投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  const entered=Promise.withResolvers(),resume=Promise.withResolvers();
  t.mock.method(f.body,'roomState',async(...args)=>{
    entered.resolve();
    await resume.promise;
    return f.roomState(...args);
  });
  const stop=new AbortController(),id='desktop-feed-cancelled';
  const reply=f.feed(id,stop.signal).then(result=>result.status,error=>error.name);
  await entered.promise;
  stop.abort();
  resume.resolve();
  const status=await reply;
  assert.equal(await f.effects([id]),0,`取消后实际响应为 ${status}`);
});

test('桌宠读取身体快照失败时，不应按旧空闲状态误投喂',async t=>{
  const f=await desktopFeedingFixture(t);
  let recover=false;
  t.mock.method(f.body,'roomState',async(...args)=>{
    if(!recover)throw Error('Synthetic unavailable Body snapshot');
    return f.roomState(...args);
  });
  const original=f.body.roomAction.bind(f.body);
  t.mock.method(f.body,'roomAction',(...args)=>{
    recover=true;
    return original(...args);
  });
  await f.body.startPlanned(f.id,{operationId:'desktop-busy-hold',kind:'hold',activity:'Resting',
    until:new Date(Date.now()+60_000).toISOString()});
  assert.equal((await f.roomState(f.id)).behavior.busy,true);
  const id='desktop-feed-read-failed';
  const response=await f.feed(id);
  assert.equal(await f.effects([id]),0,`读失败之后实际响应为 ${response.status}`);
});
