import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.CHATPET_ACTIVITY_TEST_MODULE;
const {activityPresentation,projectActivityConfig,physicalClips}=await import(modulePath?pathToFileURL(modulePath).href:'../../dist/src/desktop/platform/activity.js');
const {PetPlatform}=await import(process.env.CHATPET_PLATFORM_TEST_MODULE?pathToFileURL(process.env.CHATPET_PLATFORM_TEST_MODULE).href:'../../dist/src/desktop/platform/plugin.js');
const config=()=>({main:{animations:{idle:['待机呼吸休闲','吃午餐'],turn:['开心小跑'],clicks:['写代码'],categories:[{actions:['写代码']}],moves:{actions:['开心小跑']},events:{reply:['写代码']},baifan:['吃白饭']},pets:[{id:'main',workStatusEnabled:true}]}});
const state=(kind='idle',phase='working')=>({now:1000,her:{kind,activity:'真实活动',walking:false,asleep:false,etaMs:0,gardenWork:null},behavior:{activityId:'accepted-operation',phase},emotion:{feelings:['anger']}});
for(const [kind,clip,gap,slotId] of [['idle','待机呼吸休闲',true,'rest.anger'],['walk','原地漂浮踏步',true,'move.normal'],['eat','吃白饭',false,'food.rice'],['sleep','睡觉-循环',false,'sleep.full'],['react_shy','点击回应-害羞惊讶',false,undefined]]) {
  test(`${kind} locks every animation source to the actual activity`,()=>{
    const s=state(kind);s.her.walking=kind==='walk';s.her.asleep=kind==='sleep';
    const before=config(),actual=projectActivityConfig(before,s);
    assert.deepEqual(actual.main.animations.idle,[clip]);assert.deepEqual(actual.main.animations.turn,[clip]);assert.deepEqual(actual.main.animations.clicks,[clip]);
    assert.deepEqual(actual.main.animations.moves.actions,[]);assert.deepEqual(actual.main.animations.categories,[]);assert.equal(actual.main.pets[0].workStatusEnabled,false);
    assert.deepEqual(before,config(),'Projection must not replace saved editor configuration');
    const portrayal=activityPresentation(s);
    assert.equal(portrayal.gap,gap,'Proxy/missing detail remains explicit even when its main clip is usable');
    assert.equal(portrayal.playback.slotId,slotId);
    if(gap)assert.ok(portrayal.notice);
  });
}
for(const kind of ['garden_unknown','unknown_custom_activity'])test(`${kind} exposes missing actual media instead of claiming visual completion`,()=>{
  const actual=activityPresentation(state(kind));assert.equal(actual.exclusive,true);assert.equal(actual.gap,true);assert.match(actual.notice,/缺少对应活动动画/);assert.equal(actual.activityId,'accepted-operation');assert.equal(actual.phase,'working');
});
for(const [kind,clip] of [['drink','生活-捧杯喝水'],['garden_till','生活-松土'],['garden_plant','生活-播种'],['garden_water','生活-浇水'],['garden_fertilize','生活-施肥'],['garden_harvest','生活-采收'],['garden_sell','生活-整理交易'],['garden_buySeed','生活-整理交易'],['garden_buyCompost','生活-整理交易'],['garden_visit','待机呼吸休闲']])test(`${kind} selects its actual life media instead of a reply or random action`,()=>{
  const actual=activityPresentation(state(kind));assert.equal(actual.action,clip);
  const transaction=['garden_sell','garden_buySeed','garden_buyCompost'].includes(kind);
  assert.equal(actual.gap,transaction,'Shared trade media leaves dedicated goods/payment handover uncovered');
  if(transaction)assert.ok(actual.playback.uncovered.length>0);
  if(kind==='garden_visit')assert.ok(actual.playback.segments.some(part=>part.desktopClip==='东张西望'),'Unknown onset skips old entry, but the actual inspection segment remains registered');
  const projected=projectActivityConfig(config(),state(kind));assert.deepEqual(projected.main.animations.idle,[clip]);
  if(kind!=='garden_visit')assert.equal(physicalClips.has(clip),true,'Real work media cannot be selected as an unrelated reply expression');
});
test('reading presentation requires a structured accepted read and a real text offer',()=>{
  const s=state('planned');s.her.activity='Reading an arbitrary description does not make it real';
  assert.notEqual(activityPresentation(s).action,'生活-专心阅读');
  s.behavior.presentationKind='rest';assert.equal(activityPresentation(s).action,'待机呼吸休闲');
  s.behavior.presentationKind='reading-wait';s.behavior.readingState='unread';
  assert.equal(activityPresentation(s).action,'待机呼吸休闲');assert.match(activityPresentation(s).notice,/真实阅读内容/);
  s.behavior.presentationKind='read';s.behavior.readingState='offered';assert.equal(activityPresentation(s).action,'生活-专心阅读');
  s.her.walking=true;assert.equal(activityPresentation(s).action,'原地漂浮踏步');
  assert.equal(activityPresentation(s).playback.kind,'walk','An offered reading cannot replace the real route');
  s.her.walking=false;s.her.asleep=true;assert.equal(activityPresentation(s).action,'睡觉-循环');
  assert.notEqual(activityPresentation(state('read')).action,'生活-专心阅读','A legacy kind alone is not a content receipt');
});
test('same accepted progress is presented without a Room-window-dependent plan',()=>{
  const s=state('walk','moving');s.her.etaMs=2345;s.her.walking=true;
  const actual=activityPresentation(s);assert.equal(actual.activityId,s.behavior.activityId);assert.deepEqual(actual.progress,{now:1000,etaMs:2345,gardenWork:null});
  assert.deepEqual(activityPresentation({...s,roomOpen:true}),activityPresentation({...s,roomOpen:false}));
});
test('progress updates publish actual state without restarting its activity clip',async()=>{
  let current=state('walk','moving');current.her.walking=true;
  const writes=[];const ctx={get:name=>name==='petBehavior'?{roomState:async()=>current}:undefined,logger:()=>({warn(error){throw error;}})};
  const platform=new PetPlatform(ctx);platform.bound={id:'workspace',path:'/fixture'};platform.pets=()=>[];
  platform.setup={state:{writeSection:(key,value)=>writes.push({key,value})}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,1);
  current={...current,now:2000,her:{...current.her,etaMs:1900,pos:[2,3]}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,1);
  assert.equal(writes.filter(x=>x.key==='nativeBody/behavior').at(-1).value.her.etaMs,1900);
  current={...current,behavior:{...current.behavior,phase:'working'},her:{...current.her,kind:'eat',walking:false}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,2);
});
test('a real content-offer transition refreshes its clip once while progress remains observational',async()=>{
  let current=state('planned','pending');Object.assign(current.behavior,{presentationKind:'reading-wait',readingState:'unread'});
  const writes=[],ctx={get:name=>name==='petBehavior'?{roomState:async()=>current}:undefined,logger:()=>({warn(error){throw error;}})};
  const platform=new PetPlatform(ctx);platform.bound={id:'workspace',path:'/fixture'};platform.pets=()=>[];platform.setup={state:{writeSection:(key,value)=>writes.push({key,value})}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,1);
  current={...current,behavior:{...current.behavior,presentationKind:'read',readingState:'offered'}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,2);
  current={...current,now:2500,her:{...current.her,pos:[1,2]}};
  await platform.readBehavior();assert.equal(writes.filter(x=>x.key==='config').length,2);
});
