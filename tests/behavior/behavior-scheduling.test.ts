import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import {CompanionLife} from '../../src/living/plan/plugin.js';
import {CompanionBehavior} from '../../src/living/body/plugin.js';
import {LivingView} from '../../src/living/index.js';
import {CompanionRecordLibrary} from '../../src/core/records.js';
import {PersistentLifePlan} from '../../src/living/plan/plan.js';
import type {WorldChanged} from '../../src/contracts/living.js';
import {emptyHomeState,nextHomeBoundary} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';

/** Real coordinators and storage; only native session/model execution is absent. */
async function fixture(t:TestContext,needs:Record<string,number>={}) {
  const root=mkdtempSync(join(tmpdir(),'behavior-scheduling-'));
  const now=Date.parse('2026-11-13T05:00:00Z');
  t.mock.timers.enable({apis:['Date','setTimeout'],now});
  const workspace={id:'workspace',path:root,sessionIds:['fixture-home']};
  const directory=join(root,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
  const home=emptyHomeState(now);Object.assign(home,{
    room:'living',spot:'sofa',needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0,...needs},
    asleep:false,sleepPending:false,route:null,dwell:null,command:null,freeTarget:null,
    reactionUntil:0,lastInteractionAt:0,nextDecisionAt:0,
  });
  writeFileSync(join(directory,'home.json'),JSON.stringify(home));
  const garden=createGarden(now);garden.care.autoEnabled=false;
  writeFileSync(join(directory,'garden.json'),JSON.stringify(garden));
  writeFileSync(join(directory,'control.json'),JSON.stringify({version:1,enabled:true}));
  const library=new CompanionRecordLibrary(root,'UTC');
  const host={native:{},records:{getLibrary:()=>library},workspace:{
    status:()=>({state:'ready',target:workspace}),storageId:()=> 'storage',
    homeScope(){return {workspaceId:workspace.id,path:workspace.path,storageId:this.storageId(),bootId:'fixture-boot',generation:0};},
    readCompanionHome:()=>({sessionId:'fixture-home'}),
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({companionId:'fish',displayName:'Fixture'}),store:{meta:()=>undefined}},
  }} as unknown as PetCoreHost;
  const handlers=new Map<string,Set<(...args:any[])=>unknown>>(),changes:WorldChanged[]=[];
  const counters={ticks:0,reschedules:0,factNotices:0};
  let life:CompanionLife,behavior:CompanionBehavior;
  const emit=(name:string,...args:any[])=>{for(const handler of handlers.get(name)??[])handler(...args);};
  const logger=Object.assign(()=>({warn(){},error(){},info(){}}),{warn(){},error(){}});
  const ctx={logger,tools:{register:()=>()=>{}},effect:()=>()=>{},
    on(name:string,handler:(...args:any[])=>unknown){const list=handlers.get(name)??new Set();list.add(handler);handlers.set(name,list);return()=>list.delete(handler);},
    emit,
    get(name:string){
      if(name==='petLife')return life;
      if(name==='petBehavior')return behavior;
      if(name==='workspaceRegistry')return{get:()=>workspace,archivedSessionIds:[]};
      if(name==='sessionController')return{cancel(){}};
    },
  } as unknown as Context;
  const openBody=(observe=false)=>{
    const view=new LivingView({plan:()=>life,observe},undefined,undefined,undefined,binding=>changes.push(binding));
    const body=new CompanionBehavior(ctx,host,view);
    body.activate();
    return body;
  };
  behavior=openBody();
  life=new CompanionLife(ctx,host,'standard',{body:()=>behavior});
  t.after(async()=>{await life.close();await behavior.close();rmSync(root,{recursive:true,force:true});});
  const internal=life as any;
  await internal.synchronize();
  // Supply the external execution boundary after the real binding/plan exists.
  // No production coordinator, scheduling method or plan method is replaced.
  const attachNative=()=>{internal.runtime={isHome:(id:string)=>id==='fixture-home',snapshot:()=>({homeSessionId:'fixture-home'}),
    reschedulePlan(){counters.reschedules++;},notifyFacts(){counters.factNotices++;},stop(){},settled:async()=>{}};};
  attachNative();
  const tick=internal.tick.bind(life);
  internal.tick=async()=>{
    counters.ticks++;
    // Real queue work takes time. Advancing inside the real tick exposes the
    // feedback loop that a perfectly stationary fake Date would hide.
    t.mock.timers.tick(1);
    await tick();
  };
  const settle=async()=>{
    let stable=0;
    for(let pass=0;pass<40;pass++){
      const before=counters.ticks+changes.length;
      t.mock.timers.tick(0);
      await internal.serial;await (behavior as any).serial;
      await Promise.resolve();await Promise.resolve();
      if(counters.ticks+changes.length===before){if(++stable===2)return;}else stable=0;
    }
    assert.fail('Life and Behavior did not become quiescent without another domain event');
  };
  const advance=async(ms:number)=>{assert.ok(ms>=0);t.mock.timers.tick(ms);await settle();};
  const reopenBodyAfter=async(ms:number,nativeUnavailable=false)=>{
    // Disposal checkpoints the real executor at the shutdown time. Moving Date
    // without delivering timers models a process which was not running offline.
    await behavior.close();
    const saved=JSON.parse(readFileSync(join(directory,'home.json'),'utf8'));
    if(nativeUnavailable)internal.runtime=undefined;
    t.mock.timers.setTime(Date.now()+ms);
    // Cordis delivers the already existing optional Life service when Body is
    // mounted again. Run the production lifecycle callback, including its
    // transition publication, rather than manually waking the planner.
    behavior=openBody(true);
    return{saved,snapshot:await behavior.snapshot(workspace.id)};
  };
  await behavior.setAutonomy(workspace.id,true);await settle();
  const plan=internal.binding.plan as PersistentLifePlan;
  return{root,directory,workspace,life,get behavior(){return behavior;},plan,counters,changes,settle,advance,reopenBodyAfter,attachNative,emit,
    body:()=> (behavior as any).binding.room.state,
    garden:()=>JSON.parse(readFileSync(join(directory,'garden.json'),'utf8')),
  };
}

test('a real sustained Life plan does not reschedule itself through observation-only Body reads',async t=>{
  const f=await fixture(t),before=f.counters.ticks;
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Quiet activity',reason:'Continue one accepted activity',
    steps:[{id:'quiet',kind:'hold',activity:'Resting quietly'}],nextConsiderAt:null});
  await f.settle();
  assert.ok(f.counters.ticks-before<=3,'Dispatch and its receipt settle in bounded passes');
  const current=f.plan.read().plan!,id=current.operationId;
  assert.ok(id);assert.equal(current.status,'active');
  const rawBefore=(await f.behavior.snapshot(f.workspace.id)).needs;
  const settledTicks=f.counters.ticks,changeOffset=f.changes.length;
  for(let i=0;i<12;i++){
    await f.advance(1);
    await f.behavior.snapshot(f.workspace.id);
    await f.behavior.inspectPlanned(f.workspace.id,id!);
    await f.settle();
  }
  assert.equal(f.counters.ticks,settledTicks,'Millisecond need changes from view/receipt observations cannot wake Life');
  assert.equal(f.changes.length,changeOffset,'Sub-display reads do not broadcast');
  assert.ok((await f.behavior.snapshot(f.workspace.id)).needs.thirst>rawBefore.thirst,'Physical time still advances at full precision');
  assert.equal(f.plan.read().plan!.operationId,id);
  assert.ok(JSON.parse(readFileSync(join(f.directory,'home.json'),'utf8')).plannedExecutions[id!]);
});

test('a real empty waiting plan sleeps until its Body condition and reconsiders once',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait for thirst',reason:'No work is needed yet',steps:[],nextConsiderAt:null,
    reconsiderWhen:[{metric:'thirst',comparison:'gte',value:.2+.085/3600}]});
  await f.settle();
  const next=await f.behavior.nextWakeAt(f.workspace.id,f.plan.read().plan!.reconsiderWhen);
  assert.ok(next!==null&&next>Date.now());
  const ticks=f.counters.ticks,reschedules=f.counters.reschedules;
  await f.advance(5);await f.behavior.snapshot(f.workspace.id);await f.settle();
  assert.equal(f.counters.ticks,ticks);
  await f.advance(next!-Date.now()+1);
  const plan=f.plan.read().plan!;
  assert.deepEqual(plan.triggeredConditions,[0],JSON.stringify({next,now:Date.now(),needs:f.body().needs,plan,counters:f.counters,changes:f.changes.slice(-4)}));assert.match(plan.replanReason!,/Body condition changed/);
  assert.equal(plan.steps.length,0,'The deadline creates consideration, not a synthetic activity');
  assert.equal(f.counters.reschedules,reschedules+1,'One threshold transition earns one native consideration');
  const after=f.counters.ticks;
  await f.advance(20);await f.behavior.snapshot(f.workspace.id);await f.settle();
  assert.equal(f.counters.ticks,after);assert.equal(f.counters.reschedules,reschedules+1);
});

test('the actual Body timer wakes an already accepted garden queue at nextPlanAt',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait',reason:'No additional life goal',steps:[],nextConsiderAt:null});await f.settle();
  await f.behavior.garden(f.workspace.id,'control',{type:'till',plotId:0,requestId:'accepted-zero'});
  await f.behavior.garden(f.workspace.id,'control',{type:'till',plotId:1,requestId:'accepted-one'});await f.settle();
  assert.ok(f.body().route?.target.gardenJobId);
  await f.advance(Math.ceil(f.body().route.arriveAt-Date.now())+1);
  assert.ok(f.body().dwell?.target.gardenJobId);
  await f.advance(Math.ceil(f.body().dwell.until-Date.now())+1);
  const saved=f.garden();assert.equal(saved.care.task,null);assert.equal(saved.care.queue.length,1);
  const request=saved.care.queue[0],at=saved.care.nextPlanAt;
  assert.ok(at>Date.now());
  const ticks=f.counters.ticks;
  await f.advance(Math.max(0,at-Date.now()-1));assert.equal(f.garden().care.task,null);
  await f.advance(2);
  assert.equal(f.garden().care.task?.requestId,request.requestId);
  assert.equal(f.body().route?.target.gardenJobId,request.id);
  assert.ok(f.counters.ticks>ticks,'A real execution deadline reaches the Life event queue');
  assert.equal(f.plan.read().plan!.steps.length,0,'Only the preaccepted garden job starts');
});

test('an observation queued before a delayed Body deadline cannot consume its Life transition',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait for a real condition',reason:'Continue waiting',steps:[],nextConsiderAt:null,
    reconsiderWhen:[{metric:'thirst',comparison:'gte',value:.21}]});await f.settle();
  const next=await f.behavior.nextWakeAt(f.workspace.id,f.plan.read().plan!.reconsiderWhen);
  assert.ok(next!==null&&next>Date.now());
  const before=f.counters.reschedules;
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const inBodyQueue=new Promise<void>(resolve=>{entered=resolve;});
  const blocker=(f.behavior as any).enqueue(()=>new Promise<void>(resolve=>{release=resolve;entered();}));
  // Let an existing request wait behind I/O. The timer is then delivered into
  // the same real Body queue after that request, as after a busy event loop.
  await inBodyQueue;
  const observation=f.behavior.snapshot(f.workspace.id);
  t.mock.timers.tick(next!-Date.now()+1);release();await blocker;await observation;await f.settle();
  assert.deepEqual(f.plan.read().plan!.triggeredConditions,[0],'The later deadline must still notify Life when an earlier queued read materialized its body change');
  assert.equal(f.counters.reschedules,before+1);
});

test('a queued receipt read which completes real work still advances the same Life operation once',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'A finite rest',reason:'Finish this accepted activity',
    steps:[{id:'rest',kind:'hold',activity:'Rest',durationMinutes:.002}],nextConsiderAt:null});await f.settle();
  const original=f.plan.read().plan!,operation=original.operationId!,end=Date.parse(original.dispatchUntil!);
  const before=f.counters.reschedules;
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const blocker=(f.behavior as any).enqueue(()=>new Promise<void>(resolve=>{release=resolve;entered();}));
  await ready;const receipt=f.behavior.inspectPlanned(f.workspace.id,operation);
  t.mock.timers.tick(end-Date.now()+1);release();await blocker;assert.equal((await receipt)?.status,'completed');await f.settle();
  const result=f.plan.read().plan!;
  assert.equal(result.id,original.id);assert.equal(result.cursor,1);assert.equal(result.status,'waiting');
  assert.equal(f.counters.reschedules,before+1);assert.equal(f.body().plannedExecutions[operation].status,'completed');
  await f.advance(10);assert.equal(f.counters.reschedules,before+1);
});

test('an asynchronous arrival dispatches all remaining accepted steps without another domain event',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Move, eat and drink',reason:'Continue the accepted queue',
    steps:[{id:'travel',kind:'move',activity:'Go to balcony',room:'balcony',spot:'chair'},
      {id:'eat',kind:'body',activity:'Eat',action:'feed'},{id:'drink',kind:'body',activity:'Drink',action:'water'}],nextConsiderAt:null});
  await f.settle();
  const original=f.plan.read().plan!,counts={...f.body().counts},reschedules=f.counters.reschedules;
  await f.advance(Math.ceil(f.body().route.arriveAt-Date.now())+2);
  const finished=f.plan.read().plan!;
  assert.equal(finished.id,original.id);assert.equal(finished.cursor,3);assert.equal(finished.status,'waiting');
  assert.equal(f.body().counts.feed,counts.feed+1);assert.equal(f.body().counts.water,counts.water+1);
  assert.equal(f.counters.reschedules,reschedules+1,'Only the whole completed queue earns a model consideration');
  await f.advance(30_000);const ticks=f.counters.ticks;await f.advance(30_000);
  assert.equal(f.counters.ticks,ticks,'Completed steps do not become a polling pump');
  assert.equal(f.body().counts.feed,counts.feed+1);assert.equal(f.body().counts.water,counts.water+1);
});

test('a short owner reaction defers the original admission across Body/plan reopen without replanning',async t=>{
  const f=await fixture(t);
  await f.behavior.act(f.workspace.id,'pet','one-owner-touch','desktop');await f.settle();
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Eat after the touch',reason:'The same intention remains valid',
    steps:[{id:'eat',kind:'body',activity:'Eat',action:'feed'}],nextConsiderAt:'2099-01-01T00:00:00Z'});await f.settle();
  const pending=f.plan.read().plan!,operation=pending.operationId!,feeds=f.body().counts.feed,reschedules=f.counters.reschedules;
  assert.equal(pending.status,'active');assert.equal(pending.admissionWait?.kind,'owner-activity');assert.equal(pending.replanReason,null);
  assert.equal(f.body().plannedExecutions?.[operation],undefined,'The typed wait proves Body has not submitted this operation');
  const restored=new PersistentLifePlan(f.directory,'fish','storage','UTC');
  (f.life as any).binding.plan=restored;
  await f.reopenBodyAfter(1);await f.settle();
  assert.equal(restored.read().plan!.operationId,operation);assert.equal(f.body().counts.feed,feeds);
  await f.advance(Math.max(0,f.body().reactionUntil-Date.now())+2);
  const finished=restored.read().plan!;
  assert.equal(finished.id,pending.id);assert.equal(finished.cursor,1);assert.equal(finished.admissionWait,undefined);
  assert.equal(f.body().counts.feed,feeds+1);assert.equal(f.counters.reschedules,reschedules,'Temporary ownership causes no model reconsideration');
  f.emit('pet/core.changed');await f.settle();await f.advance(20_000);
  assert.equal(f.body().counts.feed,feeds+1,'Reopen and repeated state events cannot repeat the effect');
});

test('an unavailable native planner cannot consume the continuation of already accepted Body work',async t=>{
  const f=await fixture(t),internal=f.life as any;
  internal.startRuntime=async()=>{throw Error('Fixture native planner unavailable');};
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Move then eat despite native outage',reason:'Body owns accepted work',
    steps:[{id:'travel',kind:'move',activity:'Go to balcony',room:'balcony',spot:'chair'},
      {id:'eat',kind:'body',activity:'Eat',action:'feed'}],nextConsiderAt:null});await f.settle();
  const original=f.plan.read().plan!,feeds=f.body().counts.feed;
  await f.advance(Math.ceil(f.body().route.arriveAt-Date.now())+2);
  assert.equal(f.plan.read().plan!.id,original.id);assert.equal(f.plan.read().plan!.cursor,2);
  assert.equal(f.body().counts.feed,feeds+1);assert.match(internal.fault,/native planner unavailable/);
  await f.advance(30_000);const ticks=f.counters.ticks;await f.advance(30_000);
  assert.equal(f.counters.ticks,ticks);assert.equal(f.body().counts.feed,feeds+1);
});

test('deferred admission respects pause, starts relative duration at admission and never extends an absolute deadline',async t=>{
  const f=await fixture(t);
  await f.behavior.act(f.workspace.id,'pet','touch-before-rest','desktop');await f.settle();
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Rest after care',reason:'Keep a complete rest',
    steps:[{id:'rest',kind:'hold',activity:'Rest',durationMinutes:1}],nextConsiderAt:null});await f.settle();
  const operation=f.plan.read().plan!.operationId!;
  await f.life.controlPlan(f.workspace.id,f.plan.read().revision,'pause','Owner paused the plan');await f.settle();
  await f.advance(20_000);assert.equal(f.plan.read().plan!.status,'paused');assert.equal(f.body().plannedExecutions?.[operation],undefined);
  await f.life.controlPlan(f.workspace.id,f.plan.read().revision,'resume','Continue the same rest');await f.settle();
  const admitted=f.plan.read().plan!,execution=f.body().plannedExecutions[operation];
  assert.equal(admitted.operationId,operation);assert.equal(admitted.admissionWait,undefined);
  assert.ok(Math.abs(Date.parse(execution.until)-Date.parse(execution.startedAt)-60_000)<5,'Waiting time must not consume a relative rest');
  await f.life.controlPlan(f.workspace.id,f.plan.read().revision,'cancel','Choose a calendar-bound activity');await f.settle();
  await f.behavior.act(f.workspace.id,'pet','touch-before-deadline','desktop');await f.settle();
  const until=new Date(Date.now()+1000).toISOString();
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Rest before the deadline',reason:'Do not extend the calendar',
    steps:[{id:'calendar',kind:'hold',activity:'Calendar rest',until}],nextConsiderAt:null});await f.settle();
  const expiredOperation=f.plan.read().plan!.operationId!;
  await f.advance(12_000);
  const expired=f.plan.read().plan!;
  assert.equal(expired.status,'waiting');assert.match(expired.replanReason!,/absolute deadline elapsed/);
  assert.equal(expired.dispatchUntil,until);assert.equal(f.body().plannedExecutions?.[expiredOperation],undefined);
});

test('an unknown admission error or legacy missing receipt is never treated as safe to resubmit',async t=>{
  const f=await fixture(t),start=f.behavior.startPlanned.bind(f.behavior);let attempts=0;
  f.behavior.startPlanned=async()=>{attempts++;throw Object.assign(Error('Unknown refusal'),{name:'PlannedAdmissionWaitError'});};
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Retain uncertain work',reason:'Do not guess that a submission is safe',
    steps:[{id:'eat',kind:'body',activity:'Eat',action:'feed'}],nextConsiderAt:null});await f.settle();
  const waiting=f.plan.read().plan!,feeds=f.body().counts.feed;
  assert.equal(waiting.status,'waiting');assert.equal(waiting.admissionWait,undefined);
  f.behavior.startPlanned=start;
  (f.life as any).binding.plan=new PersistentLifePlan(f.directory,'fish','storage','UTC');
  f.emit('pet/core.changed');await f.settle();await f.advance(20_000);
  assert.equal(f.plan.read().plan!.status,'waiting');assert.equal(f.body().counts.feed,feeds);assert.equal(attempts,1);
});

test('a real failed deadline checkpoint waits for explicit recovery without a millisecond disk retry loop',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Retain a finite rest',reason:'Resume from its original receipt',
    steps:[{id:'rest',kind:'hold',activity:'Rest',durationMinutes:.002}],nextConsiderAt:null});await f.settle();
  const original=f.plan.read().plan!,operation=original.operationId!,end=Date.parse(original.dispatchUntil!);
  const room=(f.behavior as any).binding.room,actualTick=room.tick.bind(room);
  let attempts=0;
  room.tick=(...args:any[])=>{attempts++;return actualTick(...args);};
  const file=join(f.directory,'home.json'),backup=join(f.directory,'fixture-home-backup.json');
  const restore=()=>{if(existsSync(backup)){rmSync(file,{recursive:true,force:true});renameSync(backup,file);}};
  const reschedules=f.counters.reschedules;
  try {
    renameSync(file,backup);mkdirSync(file);
    await f.advance(end-Date.now()+1);
    assert.ok(attempts>0,'The real timer attempted a real checkpoint against the blocked path');
    assert.equal((f.behavior as any).awaitingRecovery,true);
    assert.match(String((f.behavior as any).fault),/生活数据文件无效/);
    const failedAttempts=attempts,ticks=f.counters.ticks;
    await f.advance(1000);
    await f.behavior.pendingFacts(f.workspace.id);
    await f.behavior.setReconsiderConditions(f.workspace.id,[]);
    await f.settle();await f.advance(1000);
    assert.equal(attempts,failedAttempts,'Elapsed time, fact reads and condition registration cannot retry disk work');
    assert.equal(f.counters.ticks,ticks,'A failed Body timer cannot create a Life feedback pump');
    assert.equal(f.plan.read().plan!.operationId,operation,'The unconfirmed execution remains on its original plan operation');
    assert.equal(f.counters.reschedules,reschedules);
    restore();
    await f.behavior.snapshot(f.workspace.id);await f.settle();
    assert.equal((f.behavior as any).awaitingRecovery,false);
    const resumed=f.plan.read().plan!;
    assert.equal(resumed.id,original.id);assert.equal(resumed.cursor,1);assert.equal(resumed.status,'waiting');
    assert.equal(f.counters.reschedules,reschedules+1);
    assert.equal(JSON.parse(readFileSync(file,'utf8')).plannedExecutions[operation].status,'completed');
    await f.advance(20);assert.equal(f.counters.reschedules,reschedules+1,'Explicit recovery cannot replay the completed activity');
  } finally {restore();}
});

test('persisted enabled Life restores one offline hour of accepted sleep before native readiness',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'An accepted sleep',reason:'Continue sleeping until another decision',
    steps:[{id:'sleep',kind:'body',activity:'Sleep',action:'sleep'}],nextConsiderAt:null});await f.settle();
  const operation=f.plan.read().plan!.operationId!;
  assert.ok(f.body().route,'The accepted sleep first travels to the existing bed');
  await f.advance(Math.ceil(f.body().route.arriveAt-Date.now())+1);
  assert.equal(f.body().asleep,true);
  assert.equal(f.body().plannedExecutions[operation].status,'completed');
  const counters={...f.body().counts},events=f.body().eventLog.length,reschedules=f.counters.reschedules;
  const {saved,snapshot}=await f.reopenBodyAfter(60*60_000,true);
  assert.equal(f.life.running(),false,'The native session boundary has not recovered yet');
  assert.equal(snapshot.autonomyEnabled,true,'Persisted Life admission, rather than native readiness, restores natural time');
  assert.equal(snapshot.home.her.asleep,true);
  assert.ok(Math.abs(snapshot.needs.energy-saved.needs.energy-.12)<1e-9);
  assert.ok(Math.abs(snapshot.needs.thirst-saved.needs.thirst-.085)<1e-9);
  assert.ok(Math.abs(snapshot.needs.hunger-saved.needs.hunger-.055)<1e-9);
  assert.deepEqual(f.body().counts,counters,'Offline reconciliation cannot repeat an accepted bodily action');
  assert.equal(f.body().eventLog.length,events,'Elapsed sleep cannot invent offline decisions or events');
  assert.equal(f.body().plannedExecutions[operation].status,'completed');
  f.attachNative();await f.settle();
  assert.equal(f.counters.reschedules,reschedules,'The same completed sleep receipt needs no second continuation');
});

test('persisted enabled Life reconciles an accepted finite hold once after an offline hour',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'A retained rest',reason:'The original accepted duration may elapse offline',
    steps:[{id:'rest',kind:'hold',activity:'Rest',durationMinutes:30}],nextConsiderAt:null});await f.settle();
  const original=f.plan.read().plan!,operation=original.operationId!,reschedules=f.counters.reschedules;
  const operations=Object.keys(f.body().plannedExecutions);
  const {saved,snapshot}=await f.reopenBodyAfter(60*60_000,true);
  assert.equal(f.life.running(),false);
  assert.equal(snapshot.autonomyEnabled,true);
  assert.ok(Math.abs(snapshot.needs.energy-saved.needs.energy+.042)<1e-9);
  assert.ok(Math.abs(snapshot.needs.thirst-saved.needs.thirst-.085)<1e-9);
  assert.deepEqual(Object.keys(f.body().plannedExecutions),operations,'Only the preaccepted execution may be reconciled offline');
  assert.equal(f.body().plannedExecutions[operation].status,'completed');
  f.attachNative();await f.settle();
  const current=f.plan.read().plan!;
  assert.equal(current.id,original.id);assert.equal(current.cursor,1);assert.equal(current.status,'waiting');
  assert.equal(f.counters.reschedules,reschedules+1,'The recovered original completion earns one continuation');
  await f.advance(20);await f.behavior.snapshot(f.workspace.id);await f.settle();
  assert.equal(f.counters.reschedules,reschedules+1);
});

test('an explicit Life off-to-on change excludes the paused offline hour from natural needs',async t=>{
  const f=await fixture(t);
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'An accepted quiet rest',reason:'Keep its progress when the owner pauses Life',
    steps:[{id:'rest',kind:'hold',activity:'Rest',durationMinutes:120}],nextConsiderAt:null});await f.settle();
  const operation=f.plan.read().plan!.operationId!;
  await f.life.control(f.workspace.id,false);await f.settle();
  assert.equal(JSON.parse(readFileSync(join(f.directory,'control.json'),'utf8')).enabled,false);
  const {saved,snapshot}=await f.reopenBodyAfter(60*60_000);
  assert.equal(snapshot.autonomyEnabled,false);assert.deepEqual(snapshot.needs,saved.needs);
  assert.equal(f.body().plannedExecutions[operation].status,'paused');
  // The fake external session is ready, so the real owner control and optional
  // Body lifecycle can run without substituting any core clock logic.
  f.attachNative();await f.life.control(f.workspace.id,true);
  const resumed=await f.behavior.snapshot(f.workspace.id);await f.settle();
  assert.equal(JSON.parse(readFileSync(join(f.directory,'control.json'),'utf8')).enabled,true);
  assert.equal(resumed.autonomyEnabled,true);
  assert.deepEqual(resumed.needs,saved.needs,'Owner reenable must not restore the interval explicitly paused before shutdown');
  await f.advance(60*60_000);
  const later=await f.behavior.snapshot(f.workspace.id);
  assert.ok(Math.abs(later.needs.thirst-saved.needs.thirst-.085)<1e-6,'Only time after reenable advances natural needs');
});


for(const [metric,rate,comparison] of [
  ['hunger',.055,'gte'],['thirst',.085,'gte'],['bladder',.095,'gte'],['energy',-.042,'lte'],['pain',-.055,'lte'],
] as const)test(`a ${metric} deadline uses its actual physical sample rather than a later caller clock`,()=>{
  const sampledAt=Date.parse('2026-11-13T05:00:00Z'),state=emptyHomeState(sampledAt);
  Object.assign(state,{route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,asleep:false,
    needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:.6}});
  const condition={metric,comparison,value:state.needs[metric]+rate*90/3600};
  const due=nextHomeBoundary(state,sampledAt,[condition],true);
  assert.ok(due!==null,'The real physical condition must have a deadline');
  assert.ok(due>sampledAt+80_000 && due<sampledAt+100_000);
  assert.equal(nextHomeBoundary(state,sampledAt+30_000,[condition],true),due,'Observation time cannot postpone the same unsampled needs');
  assert.equal(nextHomeBoundary(state,due+1,[condition],true),due,'An elapsed physical threshold remains due until physics actually advances');
  assert.equal(nextHomeBoundary(state,sampledAt+30_000,[condition],false),null,'A paused body does not schedule passive changes');
  state.route={points:[[0,0],[1,1]],departAt:sampledAt,arriveAt:sampledAt+5000,target:{room:'living',spot:'sofa'}};
  assert.equal(nextHomeBoundary(state,sampledAt+1000,[condition],true),sampledAt+5000,'An earlier accepted route retains its absolute boundary');
});

test('an empty waiting Life plan and real Emotion handlers cannot postpone the physical exhaustion boundary',async t=>{
  const f=await fixture(t,{energy:.05+.042*90/3600});
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait quietly',reason:'No new decision or activity is needed',steps:[],nextConsiderAt:null});await f.settle();
  const due=(f.behavior as any).deadlineAt,sampledAt=f.body().lastTickAt,reschedules=f.counters.reschedules;
  assert.ok(due>sampledAt && due<sampledAt+100_000);
  for(let turn=0;turn<3;turn++){
    await f.advance(20_000);
    f.emit('pet/emotion.changed',f.workspace.id,{});
    f.emit('pet/emotion.expression',{workspaceId:f.workspace.id,sessionId:'fixture-home',turn,feelings:['happy']});
    await f.settle();
    assert.equal(f.body().lastTickAt,sampledAt,'An expression updates presentation without pretending to advance physics');
    assert.equal((f.behavior as any).deadlineAt,due,'Non-physical queue work preserves the original future exhaustion deadline');
  }
  await f.advance(due-Date.now()+1);
  assert.ok(f.body().needs.energy<.05);assert.equal(f.body().needs.pain,.28);
  assert.ok(f.body().lastTickAt>=due);assert.equal(f.counters.reschedules,reschedules,'The physical effect does not create an unrequested life goal');
  assert.equal(f.plan.read().plan!.steps.length,0);
});

test('fact reads and condition registration preserve a future Body condition while replacement may move it later',async t=>{
  const f=await fixture(t),sampledAt=f.body().lastTickAt,initialThirst=f.body().needs.thirst;
  const condition=(seconds:number)=>({metric:'thirst',comparison:'gte' as const,value:initialThirst+.085*seconds/3600});
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait for thirst',reason:'No work is needed',steps:[],nextConsiderAt:null,reconsiderWhen:[condition(90)]});await f.settle();
  const original=(f.behavior as any).deadlineAt;
  await f.advance(30_000);await f.behavior.pendingFacts(f.workspace.id);await f.behavior.setReconsiderConditions(f.workspace.id,[condition(90)]);await f.settle();
  assert.equal((f.behavior as any).deadlineAt,original,'Read/registration cannot reset the future threshold from stale needs');
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait longer',reason:'The actual reconsideration condition changed',steps:[],nextConsiderAt:null,reconsiderWhen:[condition(180)]});await f.settle();
  const replacement=(f.behavior as any).deadlineAt;
  assert.ok(replacement>original+80_000,'An obsolete earlier timer is not retained after a genuine condition replacement');
  assert.ok(Math.abs(replacement-(sampledAt+180_000))<=2);
  const before=f.counters.reschedules;
  await f.advance(replacement-Date.now()+1);
  assert.deepEqual(f.plan.read().plan!.triggeredConditions,[0]);assert.equal(f.counters.reschedules,before+1);
  await f.advance(20);await f.behavior.pendingFacts(f.workspace.id);await f.settle();assert.equal(f.counters.reschedules,before+1);
});

test('a future condition restarts from the real resumed physical sample after an explicit Life pause',async t=>{
  const f=await fixture(t),initialThirst=f.body().needs.thirst;
  await f.life.updatePlan(f.workspace.id,f.plan.read().revision,{goal:'Wait for thirst',reason:'Only active time counts',steps:[],nextConsiderAt:null,
    reconsiderWhen:[{metric:'thirst',comparison:'gte',value:initialThirst+.085*90/3600}]});await f.settle();
  await f.advance(30_000);await f.life.control(f.workspace.id,false);await f.settle();
  const pausedNeeds=structuredClone(f.body().needs);
  await f.advance(60*60_000);assert.deepEqual(f.body().needs,pausedNeeds);
  await f.reopenBodyAfter(0);
  const resumedAt=Date.now();f.attachNative();await f.life.control(f.workspace.id,true);await f.settle();
  const activeHours=(f.body().lastTickAt-resumedAt)/3_600_000;
  for(const [metric,rate] of [['hunger',.055],['thirst',.085],['bladder',.095],['energy',-.042]] as const)
    assert.ok(Math.abs(f.body().needs[metric]-pausedNeeds[metric]-rate*activeHours)<1e-9,'Only actual resumed milliseconds may change '+metric);
  const due=(f.behavior as any).deadlineAt,before=f.counters.reschedules;
  assert.ok(due-Date.now()>55_000 && due-Date.now()<65_000);
  await f.advance(20_000);f.emit('pet/emotion.changed',f.workspace.id,{});await f.settle();
  assert.equal((f.behavior as any).deadlineAt,due);
  await f.advance(due-Date.now()+1);assert.deepEqual(f.plan.read().plan!.triggeredConditions,[0]);assert.equal(f.counters.reschedules,before+1);
});
