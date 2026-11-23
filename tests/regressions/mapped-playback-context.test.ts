import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import type {CompanionFactActor} from '../../src/contracts/interaction.js';
import type {PlannedExecution} from '../../src/contracts/behavior.js';
import {CompanionBehavior} from '../../src/living/body/plugin.js';
import type {CompanionLife} from '../../src/living/plan/plugin.js';
import {CompanionRoom} from '../../src/living/body/room.js';
import {resolveActivityPlayback,sampleActivityPlayback,withHomePlayback} from '../fixtures/playback.js';
import {CompanionEconomy} from '../../src/living/economy/plugin.js';
import {parsePlanDraft,PersistentLifePlan} from '../../src/living/plan/plan.js';
import {emptyHomeState,applyHomeAction,applyCatalogFood} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
const meal='food:improved-meal';
const owner:CompanionFactActor={kind:'owner',id:'owner-fixture',channel:'room',sessionId:'owner-chat'};

/** Real Body/Economy storage and methods. Only Core binding and clock are seams. */
function fixture(t:TestContext,economyEnabled=false,homeOverrides:Record<string,unknown>={},restoreElapsed=false){
  const root=mkdtempSync(join(tmpdir(),'mapped-context-')),directory=join(root,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
  const now=Date.parse('2026-11-14T04:00:00Z');t.mock.timers.enable({apis:['Date'],now});
  const state=emptyHomeState(now);Object.assign(state,{room:'living',spot:'sofa',asleep:false,sleepPending:false,
    route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,lastInteractionAt:0,kind:'idle',activity:'Quiet',
    needs:{hunger:.8,thirst:.7,energy:.8,bladder:.1,pain:0}},homeOverrides);
  const garden=createGarden(now);garden.care.autoEnabled=false;
  writeFileSync(join(directory,'home.json'),JSON.stringify(state));writeFileSync(join(directory,'garden.json'),JSON.stringify(garden));
  const target={id:'world',path:root,title:'Disposable test'},meta=new Map<string,unknown>();
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=> 'storage',runtime:{config:{companionId:'fish',ownerActorId:owner.id},
    identity:()=>({displayName:'Fixture'}),store:{persisted:()=>true,meta:(key:string)=>meta.get(key),setMeta:(key:string,value:unknown)=>meta.set(key,value),transaction:(work:()=>unknown)=>work()}}}} as unknown as PetCoreHost;
  const ctx={get:()=>undefined,emit(){},on:()=>()=>{},logger:()=>({warn(){}})} as unknown as Context;
  const economy=economyEnabled?new CompanionEconomy(ctx,host):undefined;
  economy?.prepare(target);let portReads=0;
  const makeRoom=()=>new CompanionRoom(directory,()=>undefined,()=>{portReads++;return economy?.gardenPort(target.id);});
  let room=makeRoom();room.setAutonomy(true,now,restoreElapsed);
  t.after(()=>{room.flush();economy?.close();rmSync(root,{recursive:true,force:true});});
  return {root,directory,target,economy,get room(){return room;},get portReads(){return portReads;},
    reopen(){room.flush();room=makeRoom();room.setAutonomy(true,Date.now(),restoreElapsed);return room;}};
}
const draft=(step:unknown)=>({goal:'One actual activity',reason:'Fixture',steps:[step],nextConsiderAt:null});

/** Native Behavior owns its real Room; only workspace admission and time are seams. */
async function behaviorFixture(t:TestContext,homeOverrides:Record<string,unknown>={}) {
  const root=mkdtempSync(join(tmpdir(),'mapped-behavior-')),directory=join(root,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
  const now=Date.parse('2026-11-14T04:00:00Z');t.mock.timers.enable({apis:['Date','setTimeout'],now});
  const home=Object.assign(emptyHomeState(now),{room:'living',spot:'sofa',asleep:false,sleepPending:false,route:null,dwell:null,
    command:null,freeTarget:null,reactionUntil:0,lastInteractionAt:0,kind:'idle',activity:'Quiet',
    needs:{hunger:.5,thirst:.5,energy:.7,bladder:.1,pain:0}},homeOverrides);
  const garden=createGarden(now);garden.care.autoEnabled=false;
  writeFileSync(join(directory,'home.json'),JSON.stringify(home));writeFileSync(join(directory,'garden.json'),JSON.stringify(garden));
  const target={id:'world',path:root,sessionIds:[]},admission={bodyClockState:()=>({enabled:true,restoreElapsed:true})};
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=> 'storage',runtime:{config:{companionId:'fish',ownerActorId:owner.id},
    identity:()=>({displayName:'Fixture'}),store:{meta:()=>undefined}}}} as unknown as PetCoreHost;
  const logger=Object.assign(()=>({warn(){}}),{warn(){}}),ctx={get:()=>undefined,
    on:()=>()=>{},emit(){},logger} as unknown as Context;
  const createBody=()=>new CompanionBehavior(ctx,host,{plan:()=>admission as unknown as CompanionLife});
  let body=createBody();await body.roomState(target.id);
  t.after(async()=>{await body.close();rmSync(root,{recursive:true,force:true});});
  return {root,directory,target,get body(){return body;},saved:()=>JSON.parse(readFileSync(join(directory,'home.json'),'utf8')),
    async reopen(){await body.close();body=createBody();return body.roomState(target.id).then(withHomePlayback);}};
}

test('plan parsing admits only registered slots compatible with executable fields',()=>{
  const step={id:'quiet',kind:'hold',activity:'Rest',presentationSlot:'rest.calm'};
  assert.equal(parsePlanDraft(draft(step)).steps[0].presentationSlot,'rest.calm');
  for(const presentationSlot of ['food.crab','read.main','garden.plant','sleep.full','trade.sell','input.drag','unknown-slot'])
    assert.throws(()=>parsePlanDraft(draft({...step,presentationSlot})),/动画|配对/);
  assert.throws(()=>parsePlanDraft(draft({...step,presentationSlot:42})),/动画|配对/);
  assert.equal(parsePlanDraft(draft({id:'water',kind:'body',activity:'Drink water',action:'water',presentationSlot:'drink.sequence'})).steps[0].presentationSlot,'drink.sequence');
  assert.throws(()=>parsePlanDraft(draft({id:'free',kind:'body',activity:'Free meal',action:'feed',presentationSlot:'food.crab'})),/动画|配对/);
});

test('visual hints survive real plan dispatch, Body persistence and restart',async t=>{
  const f=fixture(t),plan=new PersistentLifePlan(f.directory,'fish','storage','UTC');
  await plan.commit(0,parsePlanDraft(draft({id:'quiet',kind:'hold',activity:'Rest quietly',presentationSlot:'rest.calm'})));
  const body={startPlanned:async(_id:string,input:Parameters<CompanionBehavior['startPlanned']>[1])=>f.room.startPlanned(input),
    inspectPlanned:async(_id:string,id:string)=>f.room.inspectPlanned(id)} as unknown as CompanionBehavior;
  await plan.advance(f.target.id,body);
  const id=plan.read().plan!.operationId!;
  const first=f.room.presentationActivity();assert.equal(first.animationContext?.slotId,'rest.calm');
  assert.equal(first.animationContext?.startedAt,Date.now());assert.equal(f.room.plannedState()!.operationId,id);
  const bytes=readFileSync(join(f.directory,'home.json'),'utf8'),state=JSON.stringify(f.room.state);
  for(let i=0;i<5;i++)assert.deepEqual(f.room.presentationActivity(),first);
  assert.equal(JSON.stringify(f.room.state),state);assert.equal(readFileSync(join(f.directory,'home.json'),'utf8'),bytes);
  f.reopen();assert.deepEqual(f.room.presentationActivity(),first);assert.equal(f.room.plannedState()!.operationId,id);
});

test('incompatible direct Body hint cannot start an effect or replace a plan',t=>{
  const f=fixture(t),before=JSON.stringify(f.room.state);
  assert.throws(()=>f.room.startPlanned({operationId:'fake-read',kind:'hold',activity:'Pretend to read',presentationSlot:'read.main'}),/动画|配对/);
  assert.equal(JSON.stringify(f.room.state),before);assert.equal(f.room.plannedState(),undefined);
});

test('Body checks slots and plan fields before looking up the original execution',t=>{
  const f=fixture(t);
  const input={operationId:'drink',kind:'body',activity:'Drink water',action:'water',presentationSlot:'drink.sequence'} as const;
  const slotError='活动动画配对与当前实际活动不兼容';
  assert.throws(()=>f.room.startPlanned({...input,action:undefined, presentationSlot:'read.main'}),{message:slotError});
  const until=new Date(Date.now()+60_000).toISOString();
  assert.throws(()=>f.room.startPlanned({operationId:'garden',kind:'garden',activity:'Visit',garden:{type:['visit']},until}),
    {message:'执行活动依据真实回执结束，持续动画请另加原地或房间活动'});
  const receipt=f.room.startPlanned(input);
  assert.equal(receipt.status,'completed');
  f.reopen();
  assert.deepEqual(f.room.startPlanned(input),receipt);
  assert.throws(()=>f.room.startPlanned({...input,action:undefined,presentationSlot:'read.main'}),{message:slotError});
  assert.throws(()=>f.room.startPlanned({...input,activity:'Different drink'}),{message:'同一计划执行编号不能用于不同内容'});
});

test('accepted route uses its movement hint only until actual arrival',t=>{
  const f=fixture(t);
  f.room.startPlanned({operationId:'route',kind:'room',activity:'Go to kitchen',room:'kitchen',spot:'sink',presentationSlot:'move.right'});
  const route=structuredClone(f.room.state.route);assert.ok(route);
  const snapshot=()=>({...f.room.view(),behavior:{...f.room.presentationActivity(),
    activityId:'route',phase:f.room.plannedState()!.phase,startedAt:route.departAt}});
  const moving=snapshot(),movement=resolveActivityPlayback(moving)!;
  assert.equal(moving.her.walking,true);assert.equal(movement.kind,'walk');assert.equal(movement.slotId,'move.right');
  const movingClip=sampleActivityPlayback(movement)!;
  assert.equal(movingClip.desktopClip,'原地左转奔跑');assert.equal(movingClip.mirror,true);
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+1);f.room.tick();
  const arrived=snapshot(),rest=resolveActivityPlayback(arrived)!;
  assert.equal(arrived.her.walking,false);assert.equal(rest.kind,'rest');assert.equal(rest.slotId,'rest.calm');
  assert.equal(rest.gap,true,'The movement-only hint cannot override the actual resting phase');
  assert.equal(sampleActivityPlayback(rest)!.desktopClip,'待机呼吸休闲');
  assert.equal(f.room.plannedState()!.operationId,'route');assert.equal(f.room.plannedState()!.phase,'working');
});

test('owner touch facts keep original attribution and identity across ack/retry/restart',t=>{
  const f=fixture(t);f.room.startPlanned({operationId:'rest',kind:'hold',activity:'Rest',presentationSlot:'rest.calm'});
  const request={requestId:'one-touch',actor:owner},result=f.room.act({action:'pet'},'主人',Date.now(),request);
  const first=f.room.presentationActivity().animationContext!;
  assert.equal(first.slotId,'rest.calm');assert.equal(first.interaction?.id,result.fact!.id);
  assert.equal(first.interaction?.at,Date.now());assert.equal(first.interaction?.until,f.room.state.reactionUntil);
  assert.deepEqual(first.interaction?.actor,owner);assert.equal(first.interaction?.text,result.fact!.result.summary);
  f.room.acknowledgeFacts([result.fact!.id]);assert.equal(f.room.pendingFacts().length,0);
  assert.deepEqual(f.room.presentationActivity().animationContext,first);
  f.room.act({action:'pet'},'主人',Date.now(),request);assert.deepEqual(f.room.presentationActivity().animationContext,first);
  f.reopen();assert.deepEqual(f.room.presentationActivity().animationContext,first);
  assert.equal(f.room.plannedState()!.operationId,'rest');
});

test('expired or future owner facts cannot become fresh presentation events',t=>{
  const f=fixture(t);f.room.startPlanned({operationId:'rest',kind:'hold',activity:'Rest'});
  const now=Date.now();f.room.act({action:'pet'},'主人',now,{requestId:'past',actor:owner});
  assert.ok(f.room.presentationActivity().animationContext?.interaction);
  t.mock.timers.setTime(now+20_000);assert.equal(f.room.presentationActivity().animationContext?.interaction,undefined);
  f.room.act({action:'pet'},'主人',Date.now()+1000,{requestId:'future',actor:owner});
  assert.equal(f.room.presentationActivity().animationContext?.interaction,undefined);
});

test('companion facts are never promoted to owner touch feedback',t=>{
  const f=fixture(t);f.room.startPlanned({operationId:'rest',kind:'hold',activity:'Rest'});
  const actor:CompanionFactActor={kind:'companion',id:'fish',channel:'native-life'};
  f.room.act({action:'pet'},'大肥鱼',Date.now(),{requestId:'self',actor});
  assert.equal(f.room.presentationActivity().animationContext?.interaction,undefined);
  assert.deepEqual(f.room.pendingFacts()[0].actor,actor);
});

test('owner feedback projects the fact for each supported interaction', t => {
  const {room} = fixture(t);
  for (const action of ['pet','poke','water','feed','play','talk']) {
    const result = room.act({action,text:'合成留言'}, '主人', Date.now(), {requestId:action,actor:owner});
    const feedback = room.presentationActivity().animationContext?.interaction;
    assert.ok(result.fact, action);
    assert.equal(feedback?.action, action);
    assert.equal(feedback?.id, result.fact.id);
    t.mock.timers.setTime(Date.now() + 1);
  }
});

test('catalog food metadata is captured once with actual effects and survives authority-free viewing',t=>{
  const f=fixture(t,true),store=f.economy!.prepare(f.target);
  store.giftItem('gift-meals',meal,2,undefined,owner);
  const item=store.catalog().find(row=>row.id===meal)!;assert.equal(item.presentationSlot,'food.lunch');
  f.room.consumeFood({operationId:'one-meal',itemId:meal});
  assert.equal(f.room.state.kind,'eat');assert.equal(store.snapshot().inventory.find(row=>row.itemId===meal)!.quantity,1);
  const first=f.room.presentationActivity().animationContext!;assert.equal(first.itemId,meal);assert.equal(first.foodSlot,'food.lunch');
  assert.equal(f.room.state.companionAction.presentationSlot,'food.lunch');
  const before=readFileSync(join(f.directory,'home.json'),'utf8'),reads=f.portReads;
  for(let i=0;i<5;i++)assert.deepEqual(f.room.presentationActivity().animationContext,first);
  assert.equal(f.portReads,reads,'Rendering cannot attach/migrate Economy just to read visual metadata');
  assert.equal(readFileSync(join(f.directory,'home.json'),'utf8'),before);
  f.reopen();assert.equal(f.room.presentationActivity().animationContext?.foodSlot,'food.lunch');
  f.room.consumeFood({operationId:'one-meal',itemId:meal});
  assert.equal(store.snapshot().inventory.find(row=>row.itemId===meal)!.quantity,1,'Rendering and replay do not consume again');
});

test('food hint cannot replace trusted catalog dish or derive it from prose',t=>{
  const f=fixture(t,true),store=f.economy!.prepare(f.target);store.giftItem('gift',meal,1,undefined,owner);
  assert.throws(()=>f.room.startPlanned({operationId:'wrong-dish',kind:'economy',activity:'Eat crab',economy:{type:'consume',itemId:meal,quantity:1},presentationSlot:'food.crab'}),/动画|配对/);
  assert.equal(store.snapshot().inventory.find(row=>row.itemId===meal)!.quantity,1);
  f.room.startPlanned({operationId:'actual-dish',kind:'economy',activity:'螃蟹、小鱼干和蛋糕只是描述',economy:{type:'consume',itemId:meal,quantity:1},presentationSlot:'food.lunch'});
  assert.equal(f.room.presentationActivity().animationContext?.foodSlot,'food.lunch');
});

test('accepted body meal and water hints survive effect completion, replay and restart',t=>{
  const f=fixture(t);
  const projection=()=>resolveActivityPlayback({...f.room.view(),behavior:f.room.presentationActivity()})!;
  for(const [index,action,presentationSlot,kind] of [[0,'feed','food.bowl','eat'],[1,'water','drink.sequence','drink']] as const) {
    const input={operationId:'body-'+index,kind:'body' as const,activity:'Actual care',action,presentationSlot};
    f.room.startPlanned(input);assert.equal(f.room.plannedState(),undefined,'The effect receipt has already completed');
    assert.equal(f.room.state.companionAction.id,input.operationId);
    assert.equal(f.room.state.companionAction.presentationSlot,presentationSlot);
    const counts=structuredClone(f.room.state.counts),needs=structuredClone(f.room.state.needs);
    assert.equal(projection().kind,kind);assert.equal(projection().slotId,presentationSlot);
    f.reopen();assert.equal(projection().slotId,presentationSlot);
    f.room.startPlanned(input);assert.deepEqual(f.room.state.counts,counts);assert.deepEqual(f.room.state.needs,needs);
    assert.equal(projection().slotId,presentationSlot,'Idempotent delivery keeps the original portrayal without applying care twice');
  }
  t.mock.timers.setTime(f.room.state.reactionUntil+1);f.room.tick();
  assert.ok(f.room.state.companionAction.completedAt);assert.equal(f.room.presentationActivity().animationContext?.slotId,undefined);
});

test('accepted nap and waking stretch remain attached to their actual sleep transition',t=>{
  const f=fixture(t),nap={operationId:'nap',kind:'body' as const,activity:'Sleep',action:'sleep' as const,presentationSlot:'sleep.nap'};
  const projection=()=>resolveActivityPlayback({...f.room.view(),behavior:f.room.presentationActivity()})!;
  f.room.startPlanned(nap);assert.equal(projection().kind,'walk','Sleep portrayal never replaces its real trip to bed');
  assert.ok(f.room.state.route);t.mock.timers.setTime(Math.ceil(f.room.state.route.arriveAt)+1);f.room.tick();
  assert.equal(f.room.state.asleep,true);assert.equal(f.room.plannedState(),undefined);
  assert.equal(f.room.state.companionAction.presentationSlot,'sleep.nap');assert.equal(projection().slotId,'sleep.nap');
  const sleepAction=structuredClone(f.room.state.companionAction),sleepNeeds=structuredClone(f.room.state.needs);
  f.reopen();f.room.startPlanned(nap);
  assert.deepEqual(f.room.state.companionAction,sleepAction);assert.deepEqual(f.room.state.needs,sleepNeeds);
  assert.equal(projection().slotId,'sleep.nap');
  const wake={operationId:'wake',kind:'body' as const,activity:'Wake',action:'wake' as const,presentationSlot:'sleep.stretch'};
  f.room.startPlanned(wake);assert.equal(f.room.state.asleep,false);assert.equal(projection().kind,'wake');
  assert.equal(projection().slotId,'sleep.stretch');assert.equal(f.room.plannedState(),undefined);
  f.reopen();assert.equal(projection().slotId,'sleep.stretch');
  const wakeAction=structuredClone(f.room.state.companionAction),wakeNeeds=structuredClone(f.room.state.needs);
  f.room.startPlanned(wake);assert.deepEqual(f.room.state.companionAction,wakeAction);assert.deepEqual(f.room.state.needs,wakeNeeds);
  assert.equal(projection().slotId,'sleep.stretch');
  t.mock.timers.setTime(f.room.state.reactionUntil+1);f.room.tick();
  assert.equal(projection().kind,'idle');assert.notEqual(projection().slotId,'sleep.stretch');
});

test('body hints never transfer to another accepted plan or an independent same-kind action',t=>{
  const f=fixture(t),first={operationId:'bowl',kind:'body' as const,activity:'Basic meal',action:'feed' as const,presentationSlot:'food.bowl'};
  const projection=()=>resolveActivityPlayback({...f.room.view(),behavior:f.room.presentationActivity()})!;
  f.room.startPlanned(first);assert.equal(projection().slotId,'food.bowl');
  f.room.startPlanned({operationId:'plain',kind:'body',activity:'Another basic meal',action:'feed'});
  assert.equal(f.room.state.companionAction.id,'plain');assert.equal(f.room.state.companionAction.presentationSlot,undefined);
  assert.equal(f.room.presentationActivity().animationContext?.slotId,undefined);assert.equal(projection().slotId,'food.rice');
  f.room.startPlanned(first);assert.equal(f.room.state.companionAction.id,'plain');assert.equal(projection().slotId,'food.rice');
  f.room.startPlanned({operationId:'quiet',kind:'hold',activity:'Rest'});
  assert.equal(f.room.plannedState()!.operationId,'quiet');assert.equal(projection().kind,'rest');
  assert.equal(f.room.presentationActivity().animationContext?.slotId,undefined);
  assert.equal(projection().slotId,'rest.calm');f.reopen();assert.equal(projection().slotId,'rest.calm');
});

test('body meal hints cannot override a later actual catalog-food snapshot',t=>{
  const f=fixture(t,true),store=f.economy!.prepare(f.target);store.giftItem('gift',meal,1,undefined,owner);
  f.room.startPlanned({operationId:'bowl',kind:'body',activity:'Basic meal',action:'feed',presentationSlot:'food.bowl'});
  assert.equal(f.room.presentationActivity().animationContext?.slotId,'food.bowl');
  f.room.consumeFood({operationId:'catalog-meal',itemId:meal});
  const context=f.room.presentationActivity();
  assert.equal(context.animationContext?.slotId,undefined);assert.equal(context.animationContext?.foodSlot,'food.lunch');
  assert.equal(resolveActivityPlayback({...f.room.view(),behavior:context})!.slotId,'food.lunch');
  f.reopen();assert.equal(f.room.presentationActivity().animationContext?.foodSlot,'food.lunch');
});

const careCases=[
  {source:'body',action:'feed',autonomy:true},{source:'body',action:'feed',autonomy:false},
  {source:'body',action:'water',autonomy:true},{source:'body',action:'water',autonomy:false},
  {source:'body',action:'play',autonomy:true},{source:'body',action:'play',autonomy:false},
  {source:'body',action:'wake',autonomy:true},{source:'body',action:'wake',autonomy:false},
  {source:'owner',action:'feed',autonomy:true},{source:'owner',action:'water',autonomy:true},
  {source:'companion',action:'feed',autonomy:true},{source:'companion',action:'water',autonomy:true},
  {source:'catalog',action:'feed',autonomy:true},
] as const;
for(const example of careCases)test(`${example.source} ${example.action}: touch preserves bounded care with autonomy ${example.autonomy?'on':'off'}`,t=>{
  const f=fixture(t,example.source==='catalog');
  if(example.action==='wake') {
    f.room.startPlanned({operationId:'sleep-first',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
    t.mock.timers.setTime(Math.ceil(f.room.state.route.arriveAt)+1);f.room.tick();assert.equal(f.room.state.asleep,true);
  }
  if(example.source==='body') {
    const slots={feed:'food.bowl',water:'drink.sequence',wake:'sleep.stretch'};
    f.room.startPlanned({operationId:'bounded-care',kind:'body',activity:'Actual care',action:example.action,
      ...('play'!==example.action?{presentationSlot:slots[example.action]}:{})});
  } else if(example.source==='catalog') {
    f.economy!.prepare(f.target).giftItem('gift',meal,1,undefined,owner);f.room.consumeFood({operationId:'bounded-care',itemId:meal});
  } else {
    const actor:CompanionFactActor=example.source==='owner'?owner:{kind:'companion',id:'fish',channel:'native-life'};
    f.room.act({action:example.action},example.source==='owner'?'主人':'大肥鱼',Date.now(),{requestId:'original-care',actor});
  }
  if(!example.autonomy)f.room.setAutonomy(false);
  const original=structuredClone(f.room.state.companionAction),kind=f.room.state.kind,activity=f.room.state.activity,
    until=f.room.state.reactionUntil,started=Date.now(),hint=f.room.presentationActivity().animationContext?.slotId,
    food=f.room.presentationActivity().animationContext?.foodSlot;
  assert.ok(original && until>started);assert.equal(original.completedAt,0);
  for(const [index,action,at] of [[0,'pet',started+1000],[1,'poke',started+2000],[2,'pet',until-25]] as const) {
    t.mock.timers.setTime(at);
    const count=f.room.state.counts[action],request={requestId:'touch-'+index,actor:owner},result=f.room.act({action},'主人',Date.now(),request);
    assert.equal(f.room.state.kind,kind);assert.equal(f.room.state.activity,activity);
    assert.deepEqual(f.room.state.companionAction,original,'Touch never replaces the actual operation or its onset/hint');
    assert.equal(f.room.state.reactionUntil,until,'Touch cannot shorten or extend the accepted care deadline');
    assert.equal(f.room.state.counts[action],count+1);assert.deepEqual(result.fact!.actor,owner);
    assert.equal(result.fact!.type,action);assert.equal(result.fact!.result.status,'completed');
    assert.equal(result.fact!.occurredAt,new Date(at).toISOString());
    assert.equal(result.fact!.result.after!.energy,Math.min(1,Number(result.fact!.result.before!.energy)+(action==='pet'?.01:0)));
    const context=f.room.presentationActivity().animationContext!;
    assert.equal(context.slotId,hint);assert.equal(context.foodSlot,food);
    assert.equal(context.interaction!.id,result.fact!.id);assert.equal(context.interaction!.at,at);
    assert.equal(context.interaction!.until,Math.min(until,at+(action==='pet'?9000:6000)));
    const state=JSON.stringify(f.room.state);f.room.acknowledgeFacts([result.fact!.id]);
    const acknowledged=JSON.stringify(f.room.state),retry=f.room.act({action},'主人',Date.now(),request);
    assert.notEqual(acknowledged,state);assert.deepEqual(retry.fact,result.fact);assert.equal(JSON.stringify(f.room.state),acknowledged);
    f.reopen();if(!example.autonomy)f.room.setAutonomy(false);
    assert.equal(f.room.state.kind,kind);assert.deepEqual(f.room.state.companionAction,original);
    assert.equal(f.room.state.reactionUntil,until);assert.deepEqual(f.room.presentationActivity().animationContext,context);
  }
  t.mock.timers.setTime(until);f.room.tick();
  assert.equal(f.room.state.kind,'idle');assert.equal(f.room.state.reactionUntil,0);
  assert.equal(f.room.state.companionAction.id,original.id);assert.equal(f.room.state.companionAction.completedAt,until);
  assert.equal(f.room.presentationActivity().animationContext?.interaction,undefined);
  assert.equal(f.room.presentationActivity().animationContext?.slotId,undefined);
  f.reopen();if(!example.autonomy)f.room.setAutonomy(false);
  assert.equal(f.room.state.kind,'idle');assert.equal(f.room.state.companionAction.completedAt,until);
});

test('sleeping touch retains the original nap operation, hint and actual sleep onset',t=>{
  const f=fixture(t);f.room.startPlanned({operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  t.mock.timers.setTime(Math.ceil(f.room.state.route.arriveAt)+1);f.room.tick();
  const original=structuredClone(f.room.state.companionAction),sleepAt=f.room.state.lastEventAt.sleep;
  for(const [index,action] of ['pet','poke'].entries()) {
    t.mock.timers.setTime(Date.now()+1000);
    const result=f.room.act({action},'主人',Date.now(),{requestId:'sleep-touch-'+index,actor:owner});
    assert.equal(f.room.state.asleep,true);assert.equal(f.room.state.kind,'sleep');
    assert.deepEqual(f.room.state.companionAction,original);assert.equal(f.room.state.lastEventAt.sleep,sleepAt);
    const context=f.room.presentationActivity();assert.equal(context.animationContext?.slotId,'sleep.nap');
    assert.equal(context.animationContext?.interaction?.id,result.fact!.id);
    const playback=resolveActivityPlayback({...f.room.view(),behavior:{...context,startedAt:sleepAt}})!;
    assert.equal(playback.kind,'sleep');assert.equal(playback.slotId,'sleep.nap');assert.equal(playback.startedAt,sleepAt);
    f.reopen();assert.deepEqual(f.room.state.companionAction,original);assert.equal(f.room.presentationActivity().animationContext?.slotId,'sleep.nap');
  }
});

for(const kind of ['eat','drink','play','wake'])test(`legacy ${kind} deadline is protected without inventing an operation or historical onset`,t=>{
  const now=Date.parse('2026-11-14T04:00:00Z'),until=now+5000;
  const f=fixture(t,false,{kind,activity:'Existing bounded activity',reactionUntil:until,lastInteractionAt:now-1000});
  assert.equal(f.room.state.companionAction,undefined);
  t.mock.timers.setTime(until-40);f.room.act({action:'pet'},'主人',Date.now(),{requestId:'legacy-touch',actor:owner});
  assert.equal(f.room.state.kind,kind);assert.equal(f.room.state.reactionUntil,until);assert.equal(f.room.state.companionAction,undefined);
  assert.equal(f.room.presentationActivity().animationContext?.startedAt,undefined);
  assert.equal(f.room.presentationActivity().animationContext?.interaction?.until,until);
  f.reopen();assert.equal(f.room.state.kind,kind);assert.equal(f.room.state.companionAction,undefined);
  t.mock.timers.setTime(until);f.room.tick();assert.equal(f.room.state.kind,'idle');assert.equal(f.room.state.reactionUntil,0);
});

test('a real legacy nap dwell survives touch, completes at its original boundary and settles its effect once',t=>{
  const now=Date.parse('2026-11-14T04:00:00Z'),until=now+5000;
  // Restore an already enabled body clock; manually enabling a previously
  // paused Life intentionally discards unowned legacy automatic work.
  const f=fixture(t,false,{kind:'nap',activity:'Napping',dwell:{until,target:{room:'living',spot:'sofa',kind:'nap',
    actText:'Napping',dwellMs:5000,effect:'nap',eventType:'nap',eventText:'Finished a real nap'}}},true);
  assert.equal(f.room.state.kind,'nap');assert.ok(f.room.state.dwell);
  const dwell=structuredClone(f.room.state.dwell);
  for(const [index,action] of ['pet','poke'].entries()) {
    t.mock.timers.setTime(now+1000+index*1000);
    f.room.act({action},'主人',Date.now(),{requestId:'nap-dwell-'+index,actor:owner});
    assert.equal(f.room.state.kind,'nap');assert.deepEqual(f.room.state.dwell,dwell);assert.equal(f.room.state.companionAction,undefined);
    assert.equal(f.room.presentationActivity().animationContext?.interaction?.until,until);
    f.reopen();assert.deepEqual(f.room.state.dwell,dwell);
  }
  t.mock.timers.setTime(until);f.room.tick();assert.equal(f.room.state.dwell,null);
  assert.equal(f.room.state.eventLog.filter((event:any)=>event.type==='nap').length,1);
  const energy=f.room.state.needs.energy;f.room.tick();assert.equal(f.room.state.needs.energy,energy);
  assert.equal(f.room.state.eventLog.filter((event:any)=>event.type==='nap').length,1);
});

test('idle, ordinary reactions and an unbounded legacy nap still admit a visible free touch',t=>{
  const f=fixture(t);
  for(const [index,kind] of ['idle','react_shy','idle_look','nap'].entries()) {
    Object.assign(f.room.state,{kind,reactionUntil:0,companionAction:undefined});
    const result=f.room.act({action:'pet'},'主人',Date.now(),{requestId:'free-'+index,actor:owner});
    assert.match(f.room.state.kind,/^react_|^idle_look$/);assert.equal(f.room.state.companionAction.action,'pet');
    assert.equal(f.room.presentationActivity().animationContext?.interaction?.id,result.fact!.id);
  }
});

test('actual Behavior begins sleep entry at arrival, with restart progress and one real sleep event',async t=>{
  const f=await behaviorFixture(t,{room:'garden',spot:'compost',pose:'stand'}),requested=Date.now(),input={operationId:'sleep-trip',kind:'body' as const,activity:'Sleep',action:'sleep' as const,presentationSlot:'sleep.full'};
  await f.body.startPlanned(f.target.id,input);
  const route=structuredClone(f.saved().route),walking=await f.body.roomState(f.target.id).then(withHomePlayback);
  assert.ok(route.arriveAt-requested>10040,'The accepted trip is longer than the sleep entry movie');
  assert.equal(walking.her.asleep,false);assert.equal(walking.playback!.kind,'walk');
  assert.equal(f.saved().sleepStartedAt,0);assert.equal(f.saved().lastEventAt.sleep,undefined);
  assert.equal(f.saved().eventLog.filter((event:any)=>event.type==='sleep').length,0,'A sleep request cannot claim she is already in bed');
  t.mock.timers.setTime(Math.floor((requested+route.arriveAt)/2));await f.reopen();
  assert.deepEqual(f.saved().route,route);assert.equal(f.saved().sleepStartedAt,0);
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+300);
  const asleep=await f.body.roomState(f.target.id).then(withHomePlayback);
  assert.equal(asleep.her.asleep,true);assert.equal(asleep.behavior.startedAt,route.arriveAt);
  assert.equal(f.saved().sleepStartedAt,route.arriveAt);assert.equal(f.saved().lastEventAt.sleep,route.arriveAt);
  assert.equal(sampleActivityPlayback(asleep.playback!,Date.now())!.roomClip,'sleep_in');
  assert.equal(sampleActivityPlayback(asleep.playback!,Date.now())!.offsetMs,Date.now()-route.arriveAt);
  const original=structuredClone(f.saved().companionAction),effectAt=f.saved().plannedExecutions[input.operationId].effectAppliedAt;
  await f.body.startPlanned(f.target.id,input);assert.deepEqual(f.saved().companionAction,original);
  assert.equal(f.saved().plannedExecutions[input.operationId].effectAppliedAt,effectAt);
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+1500);const resumed=await f.reopen();
  assert.equal(resumed.behavior.startedAt,route.arriveAt);assert.equal(sampleActivityPlayback(resumed.playback!,Date.now())!.roomClip,'sleep_in');
  assert.equal(sampleActivityPlayback(resumed.playback!,Date.now())!.offsetMs,Date.now()-route.arriveAt);
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+11000);const loop=await f.reopen();
  assert.equal(sampleActivityPlayback(loop.playback!,Date.now())!.roomClip,'sleep_loop');
  assert.equal(f.saved().sleepStartedAt,route.arriveAt);assert.equal(f.saved().eventLog.filter((event:any)=>event.type==='sleep').length,1);
});

test('bedside sleep is immediate; rapid wake then sleep has a new phase despite event cooldown',async t=>{
  const f=await behaviorFixture(t,{room:'her_room',spot:'bed',pose:'lie'}),first=Date.now();
  await f.body.startPlanned(f.target.id,{operationId:'first-sleep',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.full'});
  const firstView=await f.body.roomState(f.target.id).then(withHomePlayback);assert.equal(firstView.behavior.startedAt,first);
  assert.equal(sampleActivityPlayback(firstView.playback!,Date.now())!.roomClip,'sleep_in');
  assert.equal(sampleActivityPlayback(firstView.playback!,Date.now())!.offsetMs,0);
  t.mock.timers.setTime(first+1000);await f.body.roomAction(f.target.id,{action:'wake'},'主人',{requestId:'wake',actor:owner});
  assert.equal(f.saved().asleep,false);assert.equal(f.saved().sleepStartedAt,0);
  t.mock.timers.setTime(first+1700);
  const second={requestId:'second-sleep',actor:owner};
  await f.body.roomAction(f.target.id,{action:'sleep'},'主人',second);const again=await f.body.roomState(f.target.id).then(withHomePlayback);
  assert.equal(again.her.asleep,true);assert.equal(again.behavior.startedAt,first+1700);
  assert.equal(f.saved().sleepStartedAt,first+1700);assert.equal(f.saved().lastEventAt.sleep,first);
  assert.equal(f.saved().eventLog.filter((event:any)=>event.type==='sleep').length,1,'The existing log cooldown remains independent of the real new phase');
  assert.equal(sampleActivityPlayback(again.playback!,Date.now())!.roomClip,'sleep_in');
  await f.body.roomAction(f.target.id,{action:'sleep'},'主人',second);t.mock.timers.setTime(first+2700);const resumed=await f.reopen();
  assert.equal(resumed.behavior.startedAt,first+1700);assert.equal(sampleActivityPlayback(resumed.playback!,Date.now())!.offsetMs,1000);
});

test('an unknown historical sleep onset stays unknown through observations and restart',async t=>{
  const now=Date.parse('2026-11-14T04:00:00Z'),f=await behaviorFixture(t,{room:'her_room',spot:'bed',pose:'lie',asleep:true,
    kind:'sleep',sleepStartedAt:undefined,lastEventAt:{sleep:now-2000}});
  const old=await f.body.roomState(f.target.id).then(withHomePlayback);assert.equal(old.behavior.startedAt,0);assert.equal(old.behavior.activityId,'sleep:unknown');
  assert.equal(sampleActivityPlayback(old.playback!,Date.now())!.roomClip,'sleep_loop');
  t.mock.timers.setTime(now+5000);const resumed=await f.reopen();assert.equal(resumed.behavior.startedAt,0);
  assert.equal(f.saved().sleepStartedAt,0);assert.equal(sampleActivityPlayback(resumed.playback!,Date.now())!.roomClip,'sleep_loop');
});

for(const kind of ['hold','room'] as const)test(`Life ${kind} same-bed wait ends without waking or replacing the actual nap`,async t=>{
  const f=await behaviorFixture(t,{room:'her_room',spot:'bed',pose:'lie'}),sleepAt=Date.now();
  await f.body.startPlanned(f.target.id,{operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  const original=structuredClone(f.saved().companionAction),plan=new PersistentLifePlan(f.directory,'fish','storage','UTC');
  await plan.commit(0,parsePlanDraft(draft({id:'keep-resting',kind,activity:'Continue resting',durationMinutes:1,presentationSlot:'rest.calm',
    ...(kind==='room'?{room:'her_room',spot:'bed'}:{})})));
  await plan.advance(f.target.id,f.body);const until=f.saved().dwell.until,waiting=await f.body.roomState(f.target.id).then(withHomePlayback);
  assert.equal(f.saved().dwell.target.preserveSleep,true);
  assert.equal(waiting.her.asleep,true);assert.equal(waiting.her.kind,'sleep');assert.equal(waiting.playback!.slotId,'sleep.nap');
  assert.equal(waiting.behavior.startedAt,sleepAt);assert.deepEqual(f.saved().companionAction,original);
  t.mock.timers.setTime(until);await plan.advance(f.target.id,f.body);const done=await f.body.roomState(f.target.id).then(withHomePlayback);
  assert.equal(plan.read().plan!.cursor,1);assert.equal((plan.read().plan!.execution as PlannedExecution).status,'completed');
  assert.equal(f.saved().dwell,null);assert.equal(done.her.asleep,true);assert.equal(done.her.kind,'sleep');
  assert.equal(done.playback!.slotId,'sleep.nap');assert.equal(done.behavior.startedAt,sleepAt);
  assert.deepEqual(f.saved().companionAction,original);assert.equal(f.saved().eventLog.some((event:any)=>event.type==='wake'),false);
  const resumed=await f.reopen();assert.equal(resumed.her.asleep,true);assert.equal(resumed.behavior.startedAt,sleepAt);
  await f.body.roomAction(f.target.id,{action:'wake'},'主人',{requestId:'explicit-wake',actor:owner});
  assert.equal(f.saved().asleep,false);assert.equal(f.saved().sleepStartedAt,0);
});

test('Life wait pause, restart, resume and cancel preserve sleep while its own duration follows existing pause rules',async t=>{
  const f=await behaviorFixture(t,{room:'her_room',spot:'bed',pose:'lie'}),sleepAt=Date.now();
  await f.body.startPlanned(f.target.id,{operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  const plan=new PersistentLifePlan(f.directory,'fish','storage','UTC');
  await plan.commit(0,parsePlanDraft(draft({id:'wait',kind:'hold',activity:'Continue resting',durationMinutes:1,presentationSlot:'rest.calm'})));
  await plan.advance(f.target.id,f.body);
  t.mock.timers.setTime(sleepAt+10000);await plan.control(plan.read().revision,'pause','Fixture pause',f.body,f.target.id);
  assert.equal(f.saved().dwell,null);assert.equal(f.saved().asleep,true);assert.equal(f.saved().activity,'睡着了');
  assert.equal((await f.body.roomState(f.target.id).then(withHomePlayback)).playback!.slotId,'sleep.nap');
  t.mock.timers.setTime(sleepAt+20000);const paused=await f.reopen();assert.equal(paused.her.asleep,true);
  assert.equal(paused.behavior.startedAt,sleepAt);assert.equal(paused.playback!.slotId,'sleep.nap');
  assert.equal((await f.body.inspectPlanned(f.target.id,plan.read().plan!.operationId!))!.status,'paused');
  await plan.control(plan.read().revision,'resume','Fixture resume',f.body,f.target.id);
  assert.equal(f.saved().dwell.until,Date.now()+50000,'Only the wait duration freezes; the actual sleep onset remains unchanged');
  assert.equal(f.saved().sleepStartedAt,sleepAt);
  await plan.control(plan.read().revision,'cancel','Fixture cancel',f.body,f.target.id);
  assert.equal(f.saved().dwell,null);assert.equal(f.saved().asleep,true);
  const cancelled=await f.reopen();assert.equal(cancelled.playback!.slotId,'sleep.nap');assert.equal(cancelled.behavior.startedAt,sleepAt);
  const movement=await f.body.startPlanned(f.target.id,{operationId:'cannot-move-asleep',kind:'room',activity:'Go to kitchen',room:'kitchen',spot:'sink'});
  assert.equal(movement.status,'failed');assert.equal(f.saved().route,null);assert.equal(f.saved().asleep,true);
  assert.equal(f.saved().sleepStartedAt,sleepAt);
});

for(const source of ['owner','companion','direct'] as const)for(const action of ['feed','water'] as const)
test(`sleeping ${source} ${action} is unchanged, durable on retry, and needs an explicit wake before a new request`,t=>{
  const f=fixture(t,false,{room:'her_room',spot:'bed',pose:'lie'});
  f.room.startPlanned({operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  const original=structuredClone(f.room.state),actor:CompanionFactActor=source==='companion'?{kind:'companion',id:'fish',channel:'native-life'}:owner,
    request=source==='direct'?undefined:{requestId:'sleeping-care',actor},by=source==='companion'?'大肥鱼':'主人';
  const result=f.room.act({action},by,Date.now(),request);assert.equal(result.changed,false);assert.match(result.event.text,/先叫醒/);
  for(const key of ['kind','asleep','sleepStartedAt','companionAction','reactionUntil','needs','counts'])assert.deepEqual(f.room.state[key],original[key]);
  assert.equal(f.room.presentationActivity().animationContext?.slotId,'sleep.nap');
  if(request) {
    assert.equal(result.fact!.result.status,'unchanged');assert.deepEqual(result.fact!.actor,actor);assert.match(result.fact!.result.summary,/先叫醒/);
    assert.deepEqual(result.fact!.result.before,result.fact!.result.after);f.reopen();
    assert.deepEqual(f.room.act({action},by,Date.now(),request).fact,result.fact);
  }
  f.room.act({action:'wake'},'主人',Date.now(),{requestId:'wake-for-care',actor:owner});assert.equal(f.room.state.asleep,false);
  const fresh=source==='direct'?undefined:{requestId:'awake-care',actor};
  const accepted=f.room.act({action},by,Date.now(),fresh);assert.equal(accepted.changed,true);
  assert.equal(f.room.state.counts[action],original.counts[action]+1);
  if(request) {
    const before=JSON.stringify(f.room.state),retry=f.room.act({action},by,Date.now(),request);
    assert.equal(retry.changed,false);assert.deepEqual(retry.fact,result.fact);assert.equal(JSON.stringify(f.room.state),before);
  }
});

for(const action of ['feed','water'] as const)test(`a sleeping body-plan ${action} records a real failure and cannot replay after wake`,t=>{
  const f=fixture(t,false,{room:'her_room',spot:'bed',pose:'lie'});
  f.room.startPlanned({operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  const original=structuredClone(f.room.state),input={operationId:'sleeping-care',kind:'body' as const,activity:'Care',action};
  const refused=f.room.startPlanned(input);assert.equal(refused.status,'failed');assert.match(refused.reason!,/先叫醒/);
  assert.equal(f.room.state.plannedExecutions[input.operationId].effectAppliedAt,undefined);
  assert.deepEqual(f.room.state.needs,original.needs);assert.deepEqual(f.room.state.counts,original.counts);
  assert.deepEqual(f.room.state.companionAction,original.companionAction);assert.equal(f.room.state.sleepStartedAt,original.sleepStartedAt);
  f.reopen();assert.equal(f.room.state.asleep,true);assert.equal(f.room.startPlanned(input).status,'failed');
  f.room.act({action:'wake'},'主人');const awake=structuredClone(f.room.state.needs);
  assert.equal(f.room.startPlanned(input).status,'failed');assert.deepEqual(f.room.state.needs,awake);
  t.mock.timers.setTime(f.room.state.reactionUntil);f.room.tick();
  assert.equal(f.room.startPlanned({...input,operationId:'new-awake-care'}).status,'completed');
  assert.equal(f.room.state.counts[action],original.counts[action]+1);
});

test('sleeping catalog care and pure Body helpers refuse without reservation, money, item or body effects',t=>{
  const f=fixture(t,true,{room:'her_room',spot:'bed',pose:'lie'}),store=f.economy!.prepare(f.target);
  store.giftItem('gift',meal,1,undefined,owner);
  f.room.startPlanned({operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  const original=structuredClone(f.room.state),economy=store.snapshot(),ledger=store.ledger();
  for(const action of ['feed','water']) {
    const result=applyHomeAction(original,{action,at:Date.now()});assert.equal(result.changed,false);assert.equal(result.event.reason,'sleeping');
    assert.deepEqual(result.state.needs,original.needs);assert.deepEqual(result.state.counts,original.counts);
  }
  const pure=applyCatalogFood(original,{effects:{hunger:-1,thirst:-1,energy:1},label:'Meal',source:meal,at:Date.now()});
  assert.equal(pure.changed,false);assert.equal(pure.event.reason,'sleeping');assert.deepEqual(pure.state.needs,original.needs);
  const ownerRefused=f.room.consumeFood({operationId:'sleeping-owner-food',itemId:meal});
  assert.equal(ownerRefused.status,'failed');assert.match(ownerRefused.reason!,/先叫醒/);
  const input={operationId:'sleeping-plan-food',kind:'economy' as const,activity:'Meal',economy:{type:'consume' as const,itemId:meal,quantity:1}};
  const refused=f.room.startPlanned(input);assert.equal(refused.status,'failed');assert.match(refused.reason!,/先叫醒/);
  assert.deepEqual(store.snapshot(),economy);assert.deepEqual(store.ledger(),ledger);
  assert.equal(store.itemUse('sleeping-owner-food'),undefined);assert.equal(store.itemUse(input.operationId),undefined);
  assert.deepEqual(f.room.state.needs,original.needs);assert.deepEqual(f.room.state.companionAction,original.companionAction);
  f.reopen();assert.equal(f.room.state.asleep,true);assert.equal(f.room.state.sleepStartedAt,original.sleepStartedAt);
  f.room.act({action:'wake'},'主人');const awake=structuredClone(f.room.state.needs);
  assert.deepEqual(f.room.consumeFood({operationId:'sleeping-owner-food',itemId:meal}),ownerRefused);
  assert.equal(f.room.startPlanned(input).status,'failed');assert.deepEqual(f.room.state.needs,awake);
  const after=store.snapshot();assert.equal(after.balance,economy.balance);assert.deepEqual(after.inventory,economy.inventory);
  assert.deepEqual(after.pendingUses,economy.pendingUses);assert.deepEqual(store.ledger(),ledger);
  assert.equal(store.itemUse('sleeping-owner-food'),undefined);assert.equal(store.itemUse(input.operationId),undefined);
  t.mock.timers.setTime(f.room.state.reactionUntil);f.room.tick();
  f.room.consumeFood({operationId:'new-awake-meal',itemId:meal});
  assert.equal(store.snapshot().inventory.find(row=>row.itemId===meal)!.quantity,0);
});

test('sleepPending is still awake: ordinary care retains its accepted route and may apply before actual sleep',t=>{
  const f=fixture(t);f.room.startPlanned({operationId:'sleep-trip',kind:'body',activity:'Sleep',action:'sleep'});
  const route=structuredClone(f.room.state.route);assert.equal(f.room.state.sleepPending,true);assert.equal(f.room.state.asleep,false);
  for(const action of ['feed','water'] as const) {
    const before=f.room.state.counts[action],result=f.room.act({action},'主人',Date.now(),{requestId:'pending-'+action,actor:owner});
    assert.equal(result.changed,true);assert.equal(result.fact!.result.status,'completed');assert.equal(f.room.state.counts[action],before+1);
    assert.deepEqual(f.room.state.route,route);assert.equal(f.room.state.asleep,false);assert.equal(f.room.state.sleepStartedAt,0);
  }
  t.mock.timers.setTime(Math.ceil(route.arriveAt)+1);f.room.tick();assert.equal(f.room.state.asleep,true);
  assert.equal(f.room.state.sleepStartedAt,route.arriveAt);
});

for(const kind of ['hold','room'] as const)test(`a saved ${kind} sleep wait without its new semantic flag is proven by its real row before late restoration`,t=>{
  const f=fixture(t,false,{room:'her_room',spot:'bed',pose:'lie',needs:{hunger:.2,thirst:.2,energy:.2,bladder:.1,pain:0}},true),sleepAt=Date.now(),until=sleepAt+2*3600000;
  f.room.startPlanned({operationId:'nap',kind:'body',activity:'Sleep',action:'sleep',presentationSlot:'sleep.nap'});
  f.room.startPlanned({operationId:'wait',kind,activity:'Continue resting',until:new Date(until).toISOString(),
    ...(kind==='room'?{room:'her_room',spot:'bed'}:{})});
  assert.equal(f.room.state.dwell.target.preserveSleep,true);
  const saved=JSON.parse(readFileSync(join(f.directory,'home.json'),'utf8'));delete saved.dwell.target.preserveSleep;
  writeFileSync(join(f.directory,'home.json'),JSON.stringify(saved));
  t.mock.timers.setTime(sleepAt+24*3600000);f.reopen();
  assert.equal(f.room.state.dwell,null);assert.equal(f.room.state.plannedExecutions.wait.status,'completed');
  assert.equal(f.room.state.asleep,true);assert.equal(f.room.state.sleepStartedAt,sleepAt);
  assert.equal(f.room.state.needs.energy,1,'The actual indefinite sleep is independent of its completed two-hour wait');
  assert.equal(f.room.presentationActivity().animationContext?.slotId,'sleep.nap');
  assert.equal(f.room.state.plannedExecutions.wait.input.until,new Date(until).toISOString(),'Compatibility never changes the accepted wait endpoint');
  const needs=structuredClone(f.room.state.needs);f.reopen();assert.deepEqual(f.room.state.needs,needs);assert.equal(f.room.state.sleepStartedAt,sleepAt);
});
