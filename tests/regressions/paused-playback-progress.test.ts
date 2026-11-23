import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {emptyHomeState} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
import {CompanionRoom} from '../../src/living/body/room.js';
import {resolveActivityPlayback,sampleActivityPlayback,type ActivityPlayback} from '../fixtures/playback.js';

function fixture(t:TestContext,kind:'hold'|'room'='hold',destination?:{room:string;spot:string}) {
  const directory=mkdtempSync(join(tmpdir(),'paused-playback-')),start=Date.parse('2026-11-14T05:00:00Z');
  t.mock.timers.enable({apis:['Date'],now:start});
  const state=Object.assign(emptyHomeState(start),{room:'living',spot:'sofa',asleep:false,sleepPending:false,
    route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,lastInteractionAt:0,kind:'idle',activity:'Quiet',
    needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0}});
  writeFileSync(join(directory,'home.json'),JSON.stringify(state));writeFileSync(join(directory,'garden.json'),JSON.stringify(createGarden(start)));
  let emotion:{label:string;feelings:string[];updatedAt:number}|undefined={label:'Happy',feelings:['happy'],updatedAt:start-1000};
  const make=()=>new CompanionRoom(directory,()=>emotion);
  let room=make();room.setAutonomy(true,start);
  t.after(()=>{room.flush();rmSync(directory,{recursive:true,force:true});});
  return {directory,start,get room(){return room;},at:(at:number)=>t.mock.timers.setTime(at),
    mood(at?:number){emotion=at===undefined?undefined:{label:'Happy',feelings:['happy'],updatedAt:at};},
    reopen(){room.flush();room=make();room.setAutonomy(true,Date.now());},
    persist(){writeFileSync(join(directory,'home.json'),JSON.stringify(room.state));},
    forgetOnset(){delete room.state.plannedExecutions.quiet.executionStartedAt;delete room.state.plannedExecutions.quiet.presentationBaseAt;},
    saved:()=>JSON.parse(readFileSync(join(directory,'home.json'),'utf8')),
    playback(){return resolveActivityPlayback({...room.view(),behavior:{startedAt:room.state.route?.departAt??(room.state.asleep?room.state.sleepStartedAt:0),...room.presentationActivity()}})!;},
    begin(freezeOnPause=true,until=start+120_000){room.startPlanned({operationId:'quiet',kind,activity:'Rest happily',
      ...(kind==='room'?destination??{room:room.state.room,spot:room.state.spot}:{}),
      presentationSlot:'rest.happy',until:new Date(until).toISOString(),freezeOnPause});return this.playback();}};
}
function frame(playback:ActivityPlayback,at:number) {
  const {roomClip,desktopClip,offsetMs,complete,nextInMs}=sampleActivityPlayback(playback,at)!;
  return {roomClip,desktopClip,offsetMs,complete,nextInMs};
}

for(const kind of ['hold','room'] as const) {
test(`${kind}: a frozen accepted quiet phase resumes its same clip and offset without changing its real onset`,t=>{
  const f=fixture(t,kind),initial=f.begin(),pauseAt=f.start+3000,expected=frame(initial,pauseAt);
  f.at(pauseAt);f.room.pausePlanned('quiet');const paused=f.saved().plannedExecutions.quiet;
  f.at(pauseAt+60_000);f.room.resumePlanned('quiet');const playback=f.playback(),saved=f.saved().plannedExecutions.quiet;
  assert.equal(playback.startedAt,f.start);assert.equal(playback.pausedMs,60_000);assert.deepEqual(frame(playback,Date.now()),expected);
  assert.notEqual(playback.key,initial.key,'A surface that missed paused delivery must still resample its offset');
  assert.equal(saved.executionStartedAt,f.start);assert.equal(Date.parse(saved.until),Date.parse(paused.until)+60_000);
  assert.equal(saved.pausedAt,undefined);assert.equal(saved.remainingMs,undefined);
  const stable=JSON.stringify(f.saved());for(let i=0;i<3;i++)assert.deepEqual(f.playback(),playback);
  assert.equal(JSON.stringify(f.saved()),stable,'Display reads cannot advance the receipt');
  f.room.resumePlanned('quiet');assert.equal(f.saved().plannedExecutions.quiet.pausedMs,60_000);
  f.reopen();assert.deepEqual(frame(f.playback(),Date.now()),expected);assert.equal(f.saved().plannedExecutions.quiet.pausedMs,60_000);
  f.at(Date.now()+1000);assert.deepEqual(frame(f.playback(),Date.now()),frame(initial,pauseAt+1000));
});

test(`${kind}: multiple pauses and restart retain the current cue and original phase totals`,t=>{
  const f=fixture(t,kind);f.begin();
  f.at(f.start+1000);f.room.pausePlanned('quiet');f.room.pausePlanned('quiet');f.reopen();
  f.at(f.start+21_000);f.room.resumePlanned('quiet');
  f.at(f.start+24_000);f.room.pausePlanned('quiet');f.at(f.start+64_000);f.reopen();f.room.resumePlanned('quiet');
  const saved=f.saved().plannedExecutions.quiet;assert.equal(saved.pausedMs,60_000);assert.equal(saved.executionStartedAt,f.start);
  assert.deepEqual(frame(f.playback(),Date.now()),frame({...f.playback(),pausedMs:undefined},f.start+4000));
  const receipt=f.room.inspectPlanned('quiet')!;assert.equal('pausedMs' in receipt,false);assert.equal('presentationFreeze' in receipt,false);
  assert.equal('presentationBaseAt' in receipt,false);
});

test(`${kind}: an emotion update during pause freezes only the time after that real cue began`,t=>{
  const f=fixture(t,kind);f.begin();f.at(f.start+3000);f.room.pausePlanned('quiet');
  const cueAt=f.start+30_000;f.at(cueAt);f.mood(cueAt);f.at(f.start+63_000);f.room.resumePlanned('quiet');
  const playback=f.playback(),saved=f.saved().plannedExecutions.quiet;
  assert.equal(playback.startedAt,cueAt);assert.equal(playback.pausedMs,33_000);
  assert.equal(saved.pausedMs,60_000);assert.deepEqual(saved.presentationFreeze,{onsetAt:cueAt,pausedMs:33_000});
  assert.equal(sampleActivityPlayback(playback,Date.now())!.offsetMs,0);
  f.at(Date.now()+2000);const before=frame(f.playback(),Date.now());f.room.pausePlanned('quiet');
  f.at(Date.now()+10_000);f.room.resumePlanned('quiet');assert.deepEqual(frame(f.playback(),Date.now()),before);
  f.reopen();assert.deepEqual(frame(f.playback(),Date.now()),before);
});

test(`${kind}: new emotion cues inherit no earlier pauses while unavailable Emotion keeps the phase total`,t=>{
  const f=fixture(t,kind);f.begin();f.at(f.start+1000);f.room.pausePlanned('quiet');f.at(f.start+21_000);f.room.resumePlanned('quiet');
  const cueAt=f.start+22_000;f.at(cueAt);f.mood(cueAt);assert.equal(f.playback().pausedMs,undefined);
  f.at(cueAt+3000);f.room.pausePlanned('quiet');f.at(cueAt+13_000);f.room.resumePlanned('quiet');
  assert.equal(f.playback().pausedMs,10_000);assert.equal(f.playback().startedAt,cueAt);
  f.mood();f.reopen();const fallback=f.playback();assert.equal(fallback.startedAt,f.start);assert.equal(fallback.pausedMs,30_000);
  f.at(Date.now()+1000);f.room.pausePlanned('quiet');f.at(Date.now()+10_000);f.reopen();f.room.resumePlanned('quiet');
  assert.equal(f.playback().pausedMs,40_000);f.mood(cueAt);const restored=f.playback();
  assert.equal(restored.startedAt,cueAt);assert.equal(restored.pausedMs,20_000);f.reopen();assert.deepEqual(f.playback(),restored);
});

test(`${kind}: absolute deadlines and unknown historical onsets retain their original semantics`,t=>{
  const f=fixture(t,kind),initial=f.begin(false);f.at(f.start+3000);f.room.pausePlanned('quiet');
  f.at(f.start+63_000);f.room.resumePlanned('quiet');const playback=f.playback();
  assert.equal(playback.pausedMs,undefined);assert.equal(playback.key,initial.key);assert.deepEqual(frame(playback,Date.now()),frame(initial,Date.now()));
  assert.equal(f.saved().plannedExecutions.quiet.until,new Date(f.start+120_000).toISOString());
  f.forgetOnset();f.mood();
  f.room.pausePlanned('quiet');f.at(Date.now()+1000);f.room.resumePlanned('quiet');
  const unknown=f.playback();assert.equal(unknown.startedAt,0);assert.equal(unknown.pausedMs,undefined);
  assert.equal(sampleActivityPlayback(unknown,Date.now())!.desktopClip,'待机呼吸休闲');
});

test(`${kind}: a retained absolute deadline still fails when it expires while paused`,t=>{
  const f=fixture(t,kind);f.begin(false,f.start+5000);f.at(f.start+1000);f.room.pausePlanned('quiet');
  f.at(f.start+10_000);assert.equal(f.room.resumePlanned('quiet').status,'failed');
  assert.equal(f.saved().plannedExecutions.quiet.until,new Date(f.start+5000).toISOString());
  assert.equal(f.saved().plannedExecutions.quiet.pausedMs,undefined);
});

test(`${kind}: unknown historical onset never receives a fabricated pause timeline`,t=>{
  const f=fixture(t,kind);f.begin();f.forgetOnset();f.mood();
  f.at(f.start+3000);f.room.pausePlanned('quiet');f.at(f.start+63_000);f.room.resumePlanned('quiet');
  const playback=f.playback();assert.equal(playback.startedAt,0);assert.equal(playback.pausedMs,undefined);
  assert.equal(f.saved().plannedExecutions.quiet.pausedMs,undefined);f.reopen();assert.equal(f.playback().startedAt,0);
});

test(`${kind}: a same-millisecond sleeping wait never freezes actual sleep or recovery`,t=>{
  const f=fixture(t,kind);Object.assign(f.room.state,{room:'her_room',spot:'bed',pose:'lie',asleep:true,kind:'sleep',
    sleepStartedAt:f.start,activity:'Sleeping'});const initial=f.begin(),energy=f.room.state.needs.energy;
  assert.equal(initial.kind,'sleep');assert.equal(initial.startedAt,f.start);
  assert.equal(f.saved().plannedExecutions.quiet.executionStartedAt,f.start);
  f.at(f.start+3000);f.room.pausePlanned('quiet');f.at(f.start+63_000);f.room.resumePlanned('quiet');
  const playback=f.playback();assert.equal(playback.kind,'sleep');assert.equal(playback.startedAt,f.start);assert.equal(playback.pausedMs,undefined);
  assert.equal(f.room.presentationActivity().animationContext?.presentationFreeze,undefined);
  assert.deepEqual(frame(playback,Date.now()),frame(initial,Date.now()));assert.equal(f.room.state.asleep,true);
  assert.equal(f.room.state.sleepStartedAt,f.start);assert.ok(f.room.state.needs.energy>energy);
  assert.equal(f.room.state.eventLog.some((event:any)=>event.type==='wake'),false);
  f.reopen();assert.deepEqual(frame(f.playback(),Date.now()),frame(initial,Date.now()));assert.equal(f.room.state.asleep,true);
});

test(`${kind}: the shared sampler ignores malformed pause hints and cannot overflow on a long frozen interval`,t=>{
  const f=fixture(t,kind),initial=f.begin(),longPause=60*24*60*60*1000;f.at(f.start+3000);f.room.pausePlanned('quiet');
  f.at(f.start+3000+longPause);f.room.resumePlanned('quiet');
  assert.equal(f.saved().plannedExecutions.quiet.pausedMs,longPause);
  assert.deepEqual(frame(f.playback(),Date.now()),frame(initial,f.start+3000));
  const home={her:{kind:'planned',spot:'sofa'},behavior:{presentationKind:'rest',animationContext:{startedAt:1000,
    presentationFreeze:{onsetAt:1000,pausedMs:Number.MAX_SAFE_INTEGER}}},emotion:{feelings:['happy'],updatedAt:0}};
  const playback=resolveActivityPlayback(home)!;assert.equal(playback.startedAt,1000);
  const sample=sampleActivityPlayback(playback,8_640_000_000_000_000)!;assert.equal(sample.offsetMs,0);assert.ok(Number.isFinite(sample.nextInMs));
  for(const pausedMs of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const malformed={...home,behavior:{...home.behavior,animationContext:{...home.behavior.animationContext,presentationFreeze:{onsetAt:1000,pausedMs}}}};
    assert.equal(resolveActivityPlayback(malformed)!.pausedMs,undefined);
  }
  const changed={...home,emotion:{feelings:['happy'],updatedAt:2000}};
  assert.equal(resolveActivityPlayback(changed)!.pausedMs,undefined,'A newer real cue cannot inherit an earlier pause total');
});
}

for(const unavailable of [false,true])test(`room arrival establishes its real quiet phase after a long route (economy unavailable=${unavailable})`,t=>{
  const f=fixture(t,'room',{room:'garden',spot:'compost'});if(unavailable)f.room.state.economyGardenAuthority=true;
  const initial=f.begin(),route=structuredClone(f.room.state.route);assert.ok(route);assert.equal(initial.kind,'walk');
  assert.ok(route.arriveAt-route.departAt>10_040,'The actual route outlasts the quiet intro');
  assert.equal(f.saved().plannedExecutions.quiet.presentationBaseAt,undefined);
  f.at(Math.ceil(route.arriveAt)+3000);f.room.tick();const quiet=f.playback(),baseAt=f.room.state.arrivedAt;
  assert.equal(quiet.kind,'rest');assert.equal(quiet.startedAt,baseAt);assert.equal(baseAt,route.arriveAt);
  assert.equal(f.saved().plannedExecutions.quiet.executionStartedAt,f.start);
  assert.equal(f.saved().plannedExecutions.quiet.presentationBaseAt,baseAt);
  assert.equal(sampleActivityPlayback(quiet,Date.now())!.desktopClip,'待机呼吸休闲');
  const before=frame(quiet,Date.now());f.room.pausePlanned('quiet');f.at(Date.now()+60_000);f.room.resumePlanned('quiet');
  assert.deepEqual(frame(f.playback(),Date.now()),before);assert.equal(f.playback().startedAt,baseAt);
  f.reopen();assert.deepEqual(frame(f.playback(),Date.now()),before);
});

test('room route pauses and an older emotion never count against the later quiet phase',t=>{
  const f=fixture(t,'room',{room:'garden',spot:'compost'});f.begin();const original=structuredClone(f.room.state.route);
  f.at(f.start+1000);f.room.pausePlanned('quiet');f.at(f.start+31_000);f.mood(f.start+10_000);f.reopen();f.room.resumePlanned('quiet');
  const route=structuredClone(f.room.state.route);assert.ok(route);assert.equal(route.speed,original.speed);
  assert.equal(f.saved().plannedExecutions.quiet.pausedMs,undefined);
  f.at(Math.ceil(route.arriveAt)+3000);f.room.tick();const quiet=f.playback(),baseAt=f.room.state.arrivedAt;
  assert.equal(quiet.startedAt,baseAt);assert.equal(quiet.pausedMs,undefined);
  const before=frame(quiet,Date.now());f.room.pausePlanned('quiet');f.at(Date.now()+60_000);f.room.resumePlanned('quiet');
  assert.equal(f.playback().pausedMs,60_000);assert.equal(f.saved().plannedExecutions.quiet.presentationBaseAt,baseAt);
  assert.deepEqual(frame(f.playback(),Date.now()),before);f.room.resumePlanned('quiet');f.reopen();
  assert.deepEqual(frame(f.playback(),Date.now()),before);assert.equal(f.saved().plannedExecutions.quiet.executionStartedAt,f.start);
});

test('a later owned arrival starts a new quiet phase instead of inheriting an earlier one',t=>{
  const f=fixture(t,'room');f.begin();f.at(f.start+3000);f.room.pausePlanned('quiet');
  f.at(f.start+13_000);f.room.resumePlanned('quiet');assert.equal(f.playback().pausedMs,10_000);
  f.at(f.start+14_000);f.room.act({action:'place',pos:[11.4,1.32],free:true});
  assert.equal(f.room.plannedState()!.status,'interrupted');f.at(f.start+24_000);f.room.resumePlanned('quiet');
  const route=structuredClone(f.room.state.route);assert.ok(route);assert.equal(f.saved().plannedExecutions.quiet.presentationBaseAt,undefined);
  f.at(Math.ceil(route.arriveAt)+1000);f.room.tick();assert.equal(f.playback().startedAt,route.arriveAt);assert.equal(f.playback().pausedMs,undefined);
  assert.equal(sampleActivityPlayback(f.playback(),Date.now())!.desktopClip,'待机呼吸休闲');
});

test('room restores an acknowledged physical arrival but rejects an unrelated older arrival',t=>{
  const f=fixture(t,'room',{room:'garden',spot:'compost'});f.begin();const route=structuredClone(f.room.state.route);
  f.at(Math.ceil(route.arriveAt)+1000);f.room.tick();const actualAt=f.room.state.arrivedAt;
  delete f.room.state.plannedExecutions.quiet.presentationBaseAt;f.room.state.plannedExecutions.quiet.phase='moving';
  f.persist();f.reopen();assert.equal(f.playback().startedAt,actualAt);
  delete f.room.state.plannedExecutions.quiet.presentationBaseAt;f.room.state.arrivedAt=f.start-1000;f.mood();
  f.persist();f.reopen();assert.equal(f.playback().startedAt,0);assert.equal(f.saved().plannedExecutions.quiet.presentationBaseAt,undefined);
  f.room.pausePlanned('quiet');f.at(Date.now()+5000);f.room.resumePlanned('quiet');assert.equal(f.playback().startedAt,0);
});
