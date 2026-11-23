import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {advanceHomeState,applyHomeAction,emptyHomeState,nextHomeBoundary} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
import {CompanionRoom,type RoomEconomyPort} from '../../src/living/body/room.js';
import {PersistentLifePlan,parsePlanDraft} from '../../src/living/plan/plan.js';
import type {CompanionBehavior} from '../../src/living/body/plugin.js';
import {CoreNative} from '../../src/core/native/conversation.js';
import {createLifeSourceAdapter} from '../../src/living/plan/tool-policy.js';
import type {PetCoreHost} from '../../src/core/index.js';
import type {Context} from '@deepseek-ai/cordis';
import type {CoreRuntime} from '../../src/core/runtime.js';
import {EconomyStore} from '../../src/living/economy/store.js';
import {bytesDigest} from '../../src/core/storage.js';

const owner={kind:'owner' as const,id:'owner-one',channel:'room'};
const breakfast={id:'breakfast',kind:'body' as const,activity:'Eat breakfast',action:'feed' as const};
const travel={id:'balcony',kind:'move' as const,activity:'Return to balcony',room:'balcony',spot:'chair'};
const draft=(steps:unknown[])=>({goal:'Breakfast on the balcony',reason:'Ready to eat',steps,nextConsiderAt:null});

test('plan admission distinguishes arrival, finite stays and terminal indefinite waiting',()=>{
  assert.equal(parsePlanDraft(draft([travel,breakfast])).steps[0].kind,'move');
  for(const kind of ['room','hold']) {
    const stay={id:'stay',kind,activity:'Stay',...(kind==='room'?{room:'balcony',spot:'chair'}:{})};
    assert.throws(()=>parsePlanDraft({...draft([stay,breakfast]),nextConsiderAt:'2099-01-01T00:00:00Z'}),/blocks later steps/);
    assert.equal(parsePlanDraft(draft([stay])).steps.length,1);
    assert.equal(parsePlanDraft(draft([{...stay,durationMinutes:2},breakfast])).steps.length,2);
    assert.equal(parsePlanDraft(draft([{...stay,until:'2099-01-01T00:00:00Z'},breakfast])).steps.length,2);
  }
  for(const timed of [{durationMinutes:1},{until:'2099-01-01T00:00:00Z'}])
    assert.throws(()=>parsePlanDraft(draft([{...travel,...timed},breakfast])),/actual receipts/);
  assert.throws(()=>parsePlanDraft(draft([{...travel,spot:undefined}])),/spot/);
});

test('Life preserves string-coercible plan values and checks fields before slots and timing',()=>{
  const room={id:'stay',kind:['room'],activity:'Stay'};
  const economy={id:'eat',kind:'economy',activity:'Eat',economy:{type:['consume'],itemId:'food:improved-meal',quantity:2}};
  assert.deepEqual(parsePlanDraft(draft([{...room,room:0,spot:0},economy])).steps,[room,economy]);
  const executableError='Executable activities finish on actual receipts; use a following hold or room step for sustained animation';
  assert.throws(()=>parsePlanDraft(draft([{...room,kind:['move'],durationMinutes:1}])),{message:executableError});
  const invalidSlot={...breakfast,presentationSlot:'read.main',durationMinutes:1};
  assert.throws(()=>parsePlanDraft(draft([{...invalidSlot,action:'pet'}])),{message:'Unsupported bodily activity'});
  assert.throws(()=>parsePlanDraft(draft([invalidSlot])),{message:'活动动画配对与当前实际活动不兼容'});
});

function fixture(t:{after(fn:()=>void):void;mock:{timers:{enable(options:any):void}}},economy?:RoomEconomyPort) {
  const root=mkdtempSync(join(tmpdir(),'autonomous-life-code-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const now=Date.parse('2026-11-13T05:00:00Z');t.mock.timers.enable({apis:['Date'],now});
  const home=emptyHomeState(now);Object.assign(home,{needs:{hunger:.5,thirst:.8,energy:.8,bladder:.1,pain:0},
    asleep:false,sleepPending:false,route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,eventLog:[],lastInteractionAt:0});
  writeFileSync(join(root,'home.json'),JSON.stringify(home));
  const garden=createGarden(now);garden.care.autoEnabled=false;writeFileSync(join(root,'garden.json'),JSON.stringify(garden));
  const open=()=>new CompanionRoom(root,()=>undefined,()=>economy);
  return {root,now,open,room:open()};
}

test('real arrival advances a persistent breakfast plan and feeding happens exactly once across restart',async t=>{
  const f=fixture(t);let room=f.room;room.setAutonomy(true,f.now);
  const plan=new PersistentLifePlan(f.root,'fish','world','UTC');
  const behavior={inspectPlanned:async(_:string,id:string)=>room.inspectPlanned(id),startPlanned:async(_:string,input:any)=>room.startPlanned(input)} as unknown as CompanionBehavior;
  await plan.commit(0,parsePlanDraft(draft([travel,breakfast])));
  await plan.advance('workspace',behavior);
  assert.equal(plan.read().plan!.cursor,0);
  assert.equal(room.plannedState()!.phase,'moving');
  const arrival=room.state.route.arriveAt;
  t.mock.timers.tick(Math.ceil(arrival-Date.now())+1);
  // Reopen with an owned route still persisted; no UI or model completes it.
  room=f.open();room.setAutonomy(true,Date.now());room.tick(Date.now());
  await plan.advance('workspace',behavior);
  assert.equal(plan.read().plan!.cursor,1);
  assert.equal(room.state.room,'balcony');assert.equal(room.state.spot,'chair');
  assert.equal(room.state.route,null);assert.equal(room.state.dwell,null);
  const count=room.state.counts.feed;
  await plan.advance('workspace',behavior);
  assert.equal(room.state.counts.feed,count+1);
  room=f.open();room.setAutonomy(true,Date.now());
  const restored=new PersistentLifePlan(f.root,'fish','world','UTC');
  await restored.advance('workspace',behavior);await restored.advance('workspace',behavior);
  assert.equal(room.state.counts.feed,count+1);assert.equal(restored.read().plan!.cursor,2);
});

test('arrival-only movement handles same-location, pause/resume, cancellation and replay',t=>{
  const f=fixture(t);f.room.setAutonomy(true,f.now);
  const input={operationId:'travel',...travel};
  f.room.startPlanned(input,f.now);
  assert.equal(f.room.inspectPlanned('travel',f.now)!.completion,'arrival');
  f.room.pausePlanned('travel',f.now+100);
  assert.equal(f.room.inspectPlanned('travel',f.now+100)!.status,'paused');
  f.room.resumePlanned('travel',f.now+200);
  f.room.tick(Math.ceil(f.room.state.route.arriveAt)+1);
  assert.equal(f.room.inspectPlanned('travel',Math.ceil(f.room.state.lastTickAt))!.status,'completed');
  const at=Math.ceil(f.room.state.lastTickAt);
  assert.equal(f.room.startPlanned({...input,operationId:'already-there'},at).status,'completed');
  assert.equal(f.room.state.dwell,null);
  assert.equal(f.room.startPlanned(input,at).status,'completed');
  f.room.startPlanned({...input,operationId:'cancel-trip',room:'kitchen',spot:'sink'},at);
  f.room.cancelPlanned('cancel-trip',at+100);
  f.room.tick(at+60_000);
  assert.equal(f.room.inspectPlanned('cancel-trip',at+60_000)!.status,'cancelled');
});

test('finite room stays keep their deadline while arrival-only movement works without Economy',t=>{
  const f=fixture(t);f.room.setAutonomy(true,f.now);
  f.room.startPlanned({...travel,operationId:'finite',kind:'room',until:new Date(f.now+60_000).toISOString()},f.now);
  const arrival=Math.ceil(f.room.state.route.arriveAt)+1;
  f.room.tick(arrival);
  assert.equal(f.room.inspectPlanned('finite',arrival)!.status,'running');
  assert.equal(f.room.inspectPlanned('finite',arrival)!.completion,'deadline');
  f.room.tick(f.now+60_001);
  assert.equal(f.room.inspectPlanned('finite',f.now+60_001)!.status,'completed');
  f.room.state.economyGardenAuthority=true;
  f.room.startPlanned({...travel,operationId:'no-economy',room:'kitchen',spot:'sink'},f.now+60_002);
  f.room.tick(Math.ceil(f.room.state.route.arriveAt)+1);
  assert.equal(f.room.plannedState(),undefined);
  assert.equal(f.room.inspectPlanned('no-economy',Math.ceil(f.room.state.lastTickAt))!.status,'completed');
});

test('movement cannot silently wait forever or wake a sleeping body',t=>{
  const f=fixture(t);Object.assign(f.room.state,{asleep:true,room:'her_room',spot:'bed'});
  const result=f.room.startPlanned({...travel,operationId:'sleeping-move',room:'her_room',spot:'bed'},f.now);
  assert.equal(result.status,'failed');assert.match(result.reason!,/先明确醒来/);
  assert.equal(f.room.state.asleep,true);assert.equal(f.room.state.route,null);assert.equal(f.room.state.dwell,null);
});

test('saved room plans use the same reachability check as replacements',async t=>{
  const f=fixture(t),plan=new PersistentLifePlan(f.root,'fish','world','UTC');
  const stay={...travel,kind:'room' as const};
  await plan.commit(0,parsePlanDraft(draft([stay])));
  const file=join(f.root,'life.json'),original=readFileSync(file,'utf8');
  const reopened=new PersistentLifePlan(f.root,'fish','world','UTC');
  assert.deepEqual(reopened.read(),plan.read());
  assert.equal(reopened.read().plan!.steps.length,1);
  await assert.rejects(()=>plan.commit(plan.read().revision,draft([stay,breakfast]) as any),/blocks later steps/);
  assert.equal(readFileSync(file,'utf8'),original);
  const state=JSON.parse(original);
  state.currentPlan.steps.push(breakfast);
  const unreachable=JSON.stringify(state);
  writeFileSync(file,unreachable);
  assert.throws(()=>reopened.read(),/blocks later steps/);
  assert.equal(readFileSync(file,'utf8'),unreachable);
  f.room.setAutonomy(true,f.now);
  f.room.startPlanned({operationId:'indefinite-stay',...stay},f.now);
  f.room.tick(Math.ceil(f.room.state.route.arriveAt)+1);
  const receipt=f.room.inspectPlanned('indefinite-stay',Math.ceil(f.room.state.lastTickAt))!;
  assert.equal(receipt.status,'running');assert.equal(receipt.completion,'explicit-control');
  assert.match(receipt.reason!,/后续步骤尚未开始/);
});

test('committed owner water survives retries, restart, acknowledgement and changed-payload conflicts',t=>{
  const f=fixture(t),context={requestId:'water-once',actor:owner};
  const first=f.room.act({action:'water'},'主人',f.now,context);
  assert.equal(first.fact?.actor.id,owner.id);assert.equal(first.fact?.result.after?.thirst,.4);
  const count=f.room.state.counts.water;
  const reopened=f.open();reopened.act({action:'water'},'主人',f.now,context);
  assert.equal(reopened.state.counts.water,count);assert.equal(reopened.pendingFacts().length,1);
  assert.throws(()=>reopened.act({action:'feed'},'主人',f.now,context),/同一互动请求/);
  reopened.acknowledgeFacts([first.fact!.id]);
  const again=f.open();assert.equal(again.pendingFacts().length,0);
  again.act({action:'water'},'主人',f.now,context);assert.equal(again.state.counts.water,count);
});

test('failed body checkpoint publishes neither a successful effect nor an uncommitted fact',t=>{
  const f=fixture(t),file=join(f.root,'home.json'),before=readFileSync(file,'utf8');
  mkdirSync(`${file}.${process.pid}.${f.now}.tmp`);
  assert.throws(()=>f.room.act({action:'water'},'主人',f.now,{requestId:'failed',actor:owner}));
  assert.equal(readFileSync(file,'utf8'),before);assert.equal(f.room.state.needs.thirst,.8);
  assert.equal(f.room.pendingFacts().length,0);
});

test('incidental interactions retain an accepted route and reading progress',t=>{
  const f=fixture(t);f.room.setAutonomy(true,f.now);
  f.room.startPlanned({operationId:'read-location',kind:'room',activity:'Keep reading',room:'balcony',spot:'chair'},f.now);
  const route=structuredClone(f.room.state.route),operation=f.room.plannedState()!.operationId;
  for(const action of ['pet','water','feed','talk']) {
    const result=f.room.act({action,...(action==='talk'?{text:'Hello'}:{})},'主人',f.now,{requestId:action,actor:owner});
    if(action==='pet')assert.equal(typeof result.event.reaction,'string','Keep the original immediate visual reaction without cancelling work');
    assert.deepEqual(f.room.state.route,route);assert.equal(f.room.plannedState()?.operationId,operation);
    assert.equal(f.room.plannedState()?.status,'running');
  }
});

test('planned late arrival integrates awake and sleeping phases rather than moving the arrival clock',t=>{
  const f=fixture(t),start=applyHomeAction(f.room.state,{action:'sleep',at:f.now}).state;
  const moving=advanceHomeState(start,f.now,{autonomy:false,passive:true,goalPolicy:'planned'}).state;
  assert.ok(moving.route);const arrival=moving.route.arriveAt,end=arrival+60*60_000;
  const late=advanceHomeState(moving,end,{autonomy:false,passive:true,goalPolicy:'planned'}).state;
  assert.equal(late.arrivedAt,arrival);assert.equal(late.asleep,true);
  const expected=.8-.042*(arrival-f.now)/3_600_000+.12;
  assert.ok(Math.abs(late.needs.energy-expected)<1e-9);
  assert.equal(late.route,null);assert.equal(late.dwell,null);
});

test('body condition deadlines follow its actual rates without making a new goal',t=>{
  const f=fixture(t);
  const at=nextHomeBoundary(f.room.state,f.now,[{metric:'thirst',comparison:'gte',value:.885}]);
  assert.equal(at,f.now+3_600_000);
  const later=advanceHomeState(f.room.state,at!,{autonomy:false,passive:true,goalPolicy:'planned'}).state;
  assert.ok(Math.abs(later.needs.thirst-.885)<1e-9);assert.equal(later.route,null);
  assert.ok(nextHomeBoundary(f.room.state,f.now,[])!>at!,'Only the later retained physical exhaustion boundary remains');
  assert.equal(nextHomeBoundary(f.room.state,f.now,[],false),null,'Paused passive time has no exhaustion wake');
});

test('a sustained plan stays on the same operation after ordinary owner care and a state-store reopen',async t=>{
  const f=fixture(t);f.room.setAutonomy(true,f.now);
  const plan=new PersistentLifePlan(f.root,'fish','world','Asia/Ho_Chi_Minh');
  const behavior={inspectPlanned:async(_:string,id:string)=>f.room.inspectPlanned(id),startPlanned:async(_:string,input:any)=>f.room.startPlanned(input)} as unknown as CompanionBehavior;
  await plan.commit(0,{goal:'Read',reason:'Interested',steps:[{id:'rest',kind:'hold',activity:'Reading quietly'}],nextConsiderAt:null});
  await plan.advance('workspace',behavior);const original=plan.read().plan!;
  f.room.act({action:'pet'},'主人',f.now,{requestId:'touch',actor:owner});await plan.advance('workspace',behavior);
  const reopened=new PersistentLifePlan(f.root,'fish','world','Asia/Ho_Chi_Minh').read().plan!;
  assert.equal(reopened.id,original.id);assert.equal(reopened.operationId,original.operationId);
  assert.equal(reopened.status,'active');assert.equal(reopened.nextConsiderAt,null);
});

test('admitted system fact batches preserve the owner actor without acquiring owner-message authority',t=>{
  const f=fixture(t);f.room.act({action:'water'},'主人',f.now,{requestId:'traceable',actor:owner});
  const values=new Map<string,unknown>(),store={get:(table:string,key:string)=>values.get(table+key),put:(table:string,key:string,value:unknown)=>values.set(table+key,value)};
  const runtime={store,config:{ownerActorId:'owner-one',companionId:'fish'}} as unknown as CoreRuntime;
  const native=new CoreNative(runtime),scope={workspaceId:'workspace',path:f.root,storageId:'world',guest:false};
  native.resolveNativeScope=()=>scope;
  native.sourceTable.register(createLifeSourceAdapter({} as Context,{native,workspace:{runtime}} as PetCoreHost,()=>true));
  native.observeInputs('home',1,[{id:'fact-message',source:{kind:'dsh-world-life',facts:f.room.pendingFacts()},content:[{type:'text',text:'Owner supplied water'}]} as any]);
  const sources=[...values.entries()].filter(([key])=>key.startsWith('source')).map(([,value])=>value as any);
  assert.ok(sources.some(source=>source.actorId==='owner-one'&&source.origin==='virtual_action'));
  assert.ok(!sources.some(source=>source.origin==='owner_statement'));
  assert.ok(sources.some(source=>source.actorId==='system:companion-world'));
});

test('facts prepared before a new native turn remain sources of its reply and retain their originating session',async t=>{
  const f=fixture(t);f.room.act({action:'water'},'主人',f.now,{requestId:'from-room',actor:{...owner,sessionId:'origin-room'}});
  const values=new Map<string,unknown>(),store={get:(table:string,key:string)=>values.get(table+key),put:(table:string,key:string,value:unknown)=>values.set(table+key,value)};
  const runtime={store,config:{ownerActorId:'owner-one',companionId:'fish'}} as unknown as CoreRuntime;
  const native=new CoreNative(runtime),scope={workspaceId:'workspace',path:f.root,storageId:'world',guest:false};
  native.resolveNativeScope=()=>scope;native.memory={prepare:async()=>{}} as any;
  native.observeInputs('owner-chat',1,[]);
  const ids=native.observeFacts('owner-chat',f.room.pendingFacts());
  const work=store.get('memory-source-work',ids[0]) as any;
  assert.equal(work.attribution.sessionId,'origin-room');assert.equal(work.attribution.observedInSessionId,'owner-chat');
  native.observeInputs('owner-chat',2,[{id:'owner-question',source:{kind:'user'},content:[{type:'text',text:'What just happened?'}]} as any]);
  await native.finishTurn('owner-chat',2,{state:'completed',text:'You gave me water.'} as any);
  const reply=[...values.entries()].find(([key,value])=>key.startsWith('source')&&(value as any).origin==='model_interpretation')![1] as any;
  assert.ok(reply.rootSourceIds.includes(ids[0]));
});

test('prepared private facts cannot be associated with a later guest scope',t=>{
  const f=fixture(t);f.room.act({action:'water'},'主人',f.now,{requestId:'owner-only',actor:owner});
  const values=new Map<string,unknown>(),store={get:(table:string,key:string)=>values.get(table+key),put:(table:string,key:string,value:unknown)=>values.set(table+key,value)};
  const native=new CoreNative({store,config:{ownerActorId:'owner',companionId:'fish'}} as unknown as CoreRuntime);
  let guest=false;native.resolveNativeScope=()=>({workspaceId:'workspace',path:f.root,storageId:'world',guest});
  const ids=native.observeFacts('scope-switch',f.room.pendingFacts());guest=true;
  assert.throws(()=>native.observeInputs('scope-switch',2,[]),/bound workspace/);
  assert.ok(!(store.get('native-current-inputs','scope-switch') as string[]).includes(ids[0]));
});

function economicBody(t:any) {
  const f=fixture(t),store=new EconomyStore({workspacePath:f.root,storageId:'world',companionId:'fish',
    legacyGarden:{state:JSON.parse(readFileSync(join(f.root,'garden.json'),'utf8')),sourcePath:join(f.root,'garden.json'),sourceHash:bytesDigest(readFileSync(join(f.root,'garden.json')))}});
  t.after(()=>store.close());let settlement=true;
  const reservation=(value:any)=>({...value,label:'Fixture meal'});
  const port:RoomEconomyPort={loadGarden:(now,clock)=>store.readGarden(now,clock),saveGarden:state=>store.writeGarden(state,state.economyRevision),
    actGarden:(input,now,clock)=>store.applyGarden(input,String(input.requestId),now,clock) as any,gardenRules:()=>store.readGarden().economyConfig,
    transaction:(id,input)=>{if(input.type==='buy')store.purchase(id,input.itemId,input.quantity);else store.sell(id,input.itemId,input.quantity);return {status:'completed'};},
    preflightFood:id=>{assert.ok(store.snapshot().inventory.find(row=>row.itemId===id)!.available>0);},
    reserveFood:(id,item)=>reservation(store.beginUse(id,item)),inspectUse:id=>{const row=store.itemUse(id);return row&&reservation(row);},
    finishFood:(id,proof)=>{if(!settlement)throw Error('settlement temporarily unknown');return reservation(store.finishUse(id,proof));},
    cancelUse:(id,proof)=>{const row=store.cancelUse(id,proof);return row&&reservation(row);},
    readSegment:(id,input)=>store.readOffer(id,input),confirmRead:(id,token)=>store.confirmReading(id,token),readingStatus:(id,input)=>store.readingStatus(id,input)};
  const room=new CompanionRoom(f.root,()=>undefined,()=>port);room.setAutonomy(true,f.now);
  store.giftItem('meals','food:improved-meal',3);
  return {...f,room,store,get settlement(){return settlement;},set settlement(value:boolean){settlement=value;}};
}

test('uncertain inventory food retains its return activity despite rejected replacement and repeated food attempts',t=>{
  const f=economicBody(t);f.room.startPlanned({operationId:'original',kind:'hold',activity:'Reading'},f.now);f.settlement=false;
  f.room.consumeFood({operationId:'meal-one',itemId:'food:improved-meal',interaction:{requestId:'feed-one',actor:owner}},f.now);
  const hunger=f.room.state.needs.hunger;
  assert.throws(()=>f.room.startPlanned({operationId:'rejected',kind:'hold',activity:'New'},f.now),/未结束/);
  assert.equal(f.room.state.interactionReturn,'original');
  assert.throws(()=>f.room.consumeFood({operationId:'meal-two',itemId:'food:improved-meal',interaction:{requestId:'feed-two',actor:owner}},f.now),/原餐食/);
  assert.equal(f.room.state.interactionReturn,'original');assert.equal(f.room.state.needs.hunger,hunger);
  f.settlement=true;f.room.tick(f.now+13_000);
  assert.equal(f.room.plannedState()?.operationId,'original');assert.equal(f.room.plannedState()?.status,'running');
  assert.equal(f.store.snapshot().inventory.find(row=>row.itemId==='food:improved-meal')!.quantity,2);
  const pending=f.room.pendingFacts();assert.equal(pending.length,1);
  f.room.acknowledgeFacts([pending[0].id]);assert.deepEqual(f.room.readFacts([pending[0].id]),pending);
});

test('a cancelled return activity stays cancelled after food settlement and cross-action request reuse conflicts',t=>{
  const f=economicBody(t);f.room.act({action:'water'},'主人',f.now,{requestId:'collision',actor:owner});
  assert.throws(()=>f.room.consumeFood({operationId:'collision-meal',itemId:'food:improved-meal',interaction:{requestId:'collision',actor:owner}},f.now),/同一互动请求/);
  assert.equal(f.room.pendingFacts()[0].type,'water');
  f.room.startPlanned({operationId:'cancel-original',kind:'hold',activity:'Rest'},f.now+9_000);f.settlement=false;
  f.room.consumeFood({operationId:'pending-meal',itemId:'food:improved-meal'},f.now+9_000);
  f.room.cancelPlanned('cancel-original',f.now+9_001);f.settlement=true;f.room.tick(f.now+23_000);
  assert.equal(f.room.inspectPlanned('cancel-original',f.now+23_000)?.status,'cancelled');assert.equal(f.room.plannedState(),undefined);
});

test('accepted queued garden work has its own next deadline while paused passive time has none',t=>{
  const f=fixture(t);assert.equal(f.room.nextWakeAt(f.now),null);
  f.room.garden('control',{type:'till',plotId:0,requestId:'plot-zero'},f.now);
  f.room.garden('control',{type:'till',plotId:1,requestId:'plot-one'},f.now);
  f.room.tick(f.room.state.route.arriveAt);const done=f.room.state.dwell.until;f.room.tick(done+1);
  const garden=JSON.parse(readFileSync(join(f.root,'garden.json'),'utf8'));
  assert.equal(garden.care.queue.length,1);assert.equal(garden.care.task,null);
  assert.ok(Math.abs(f.room.nextWakeAt(done+1)!-garden.care.nextPlanAt)<1,'The accepted queue wakes at its own millisecond deadline');
  f.room.tick(garden.care.nextPlanAt);assert.ok(f.room.state.route?.target.gardenJobId);
});

test('a pain-only reconsideration condition still wakes at the retained exhaustion transition',t=>{
  const f=fixture(t);f.room.state.needs.energy=.06;f.room.state.needs.pain=0;
  const at=nextHomeBoundary(f.room.state,f.now,[{metric:'pain',comparison:'gte',value:.28}]);assert.ok(at!>f.now && at!<f.now+3_600_000);
  const advanced=advanceHomeState(f.room.state,at!,{autonomy:false,passive:true,goalPolicy:'planned'});assert.equal(advanced.state.needs.pain,.28);
});
