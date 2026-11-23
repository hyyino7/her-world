import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionRoom} from '../../src/living/body/room.js';
import {initialBodyState} from '../../src/living/body/initial-state.js';
import {createGarden} from '#feiyu-garden';
import {parseCompanionConfiguration,resolveCompanionSettings} from '../../src/core/companion-settings.js';
const H=3_600_000, start=Date.parse('2026-11-14T00:00:00Z');
function fixture(t:any,needs={},extra={},hours=4){
  t.mock.timers.enable({apis:['Date'],now:start});
  const dir=mkdtempSync(join(tmpdir(),'offline-body-policy-'));
  const state=initialBodyState(start);Object.assign(state,{needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0,...needs},...extra});
  writeFileSync(join(dir,'home.json'),JSON.stringify(state));
  const create=()=>new CompanionRoom(dir,()=>undefined,()=>undefined,()=>({hours,needCeiling:.7,energyFloor:.35}));
  const room=create();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const restore=(at:number)=>{t.mock.timers.setTime(at);room.setAutonomy(true,at,true);return room.state;};
  return {dir,room,create,restore};
}
test('offline defaults remain configurable and legacy empty choices stay unconfigured',()=>{
  const config=parseCompanionConfiguration({});assert.equal(config.offlineBodyHours,null);
  assert.equal(resolveCompanionSettings(config).offlineBodyHours,4);
  assert.equal(resolveCompanionSettings(parseCompanionConfiguration({offlineBodyHours:1})).offlineBodyHours,1);
  assert.equal(resolveCompanionSettings(parseCompanionConfiguration({offlineBodyHours:0})).offlineBodyHours,0);
  assert.throws(()=>parseCompanionConfiguration({offlineBodyHours:-1}),/Invalid offlineBodyHours/);
});
for(const hours of [0,1,4,12])test(`offline negative time uses configured ${hours} hours once`,t=>{
  const f=fixture(t,{}, {},hours),s=f.restore(start+72*H);
  assert.ok(Math.abs(s.needs.hunger-Math.min(.7,.2+.055*hours))<1e-9);
  assert.ok(s.needs.thirst<=.7);assert.ok(s.needs.bladder<=.7);assert.ok(s.needs.energy>=.35);
  assert.equal(s.needs.pain,0);assert.equal(s.lastTickAt,start+72*H);
  assert.equal(s.eventLog.length,0);assert.equal(s.offlineBodyWindow,undefined);
  f.room.flush();const other=f.create();other.setAutonomy(true,start+72*H,true);
  assert.deepEqual(other.state.needs,s.needs,'same absence is not credited again');
});
test('the saved need ceiling never heals severe pre-existing needs or pain',t=>{
  const f=fixture(t,{hunger:.95,thirst:.96,energy:.02,pain:.8});const s=f.restore(start+120*H);
  assert.equal(s.needs.hunger,.95);assert.equal(s.needs.thirst,.96);assert.equal(s.needs.energy,.02);assert.equal(s.needs.pain,.8);
});
test('explicit pause freezes body and crop time without offline catch-up on enable',t=>{
  const f=fixture(t);t.mock.timers.setTime(start+72*H);
  f.room.setAutonomy(true,start+72*H,false);
  assert.deepEqual(f.room.state.needs,{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0});
});
test('accepted sleeping recovery uses real duration and ends at the accepted boundary',t=>{
  const until=start+2*H;
  const f=fixture(t,{energy:.2},{asleep:true,kind:'sleep',room:'her_room',spot:'bed',
    dwell:{until,target:{room:'her_room',spot:'bed',kind:'planned',actText:'Accepted sleep',plannedOperationId:'sleep-window',plannedUntil:until}}});
  const s=f.restore(start+24*H);
  assert.ok(Math.abs(s.needs.energy-(.2+.12*2-.042*2))<1e-9);
  assert.equal(s.asleep,false);assert.equal(s.dwell,null);
});
test('already sleeping recovery is not limited by the negative-time allowance',t=>{
  const f=fixture(t,{energy:.1},{asleep:true,kind:'sleep',room:'her_room',spot:'bed'});
  const s=f.restore(start+10*H);assert.equal(s.needs.energy,1);assert.ok(Math.abs(s.needs.hunger-.42)<1e-9);
});
test('quiet rest has no invented recovery and normal live time is not capped at four hours',t=>{
  const f=fixture(t,{energy:1});f.room.setAutonomy(true,start,false);
  f.room.tick(start+12*H);assert.ok(Math.abs(f.room.state.needs.energy-(1-.042*12))<1e-9);
});
test('real recovery does not retain the former severe state as permission for later offline deterioration',t=>{
  const until=start+2*H;
  const f=fixture(t,{energy:.02},{asleep:true,kind:'sleep',room:'her_room',spot:'bed',
    dwell:{until,target:{room:'her_room',spot:'bed',kind:'planned',actText:'Accepted sleep',plannedOperationId:'sleep-recovery',plannedUntil:until}}});
  const s=f.restore(start+24*H);assert.ok(Math.abs(s.needs.energy-.26)<1e-9,'No invented healing to .35 or renewed deterioration toward .02');
});
test('invalid persisted offline window is preserved and reported',t=>{
  const f=fixture(t),file=join(f.dir,'home.json');const s=JSON.parse(readFileSync(file,'utf8'));
  s.offlineBodyWindow={startAt:start,endAt:start+H,negativeUntil:start+H};writeFileSync(file,JSON.stringify(s));
  const before=readFileSync(file);assert.throws(()=>f.create(),/离线/);assert.deepEqual(readFileSync(file),before);
});
test('a partial durable offline checkpoint cannot obtain a second consumption allowance',t=>{
  const f=fixture(t),file=join(f.dir,'home.json'),s=JSON.parse(readFileSync(file,'utf8'));
  Object.assign(s,{lastTickAt:start+2*H,needs:{...s.needs,hunger:.31},offlineBodyWindow:{
    startAt:start,endAt:start+24*H,negativeUntil:start+4*H,energyFloor:.35,
    needCeilings:{hunger:.7,thirst:.7,bladder:.7}}});writeFileSync(file,JSON.stringify(s));
  t.mock.timers.setTime(start+72*H);const resumed=f.create();resumed.setAutonomy(true,Date.now(),true);
  assert.ok(Math.abs(resumed.state.needs.hunger-.42)<1e-9);
});
for(const paused of [false,true])test(`crop elapsed time stays separate from body allowance (paused=${paused})`,t=>{
  const f=fixture(t),g=createGarden(start);Object.assign(g.plots[0],{tilled:true,cropId:'radish',progress:0,moisture:1,plantedAt:start,
    cropProfile:{growMs:12*H,yield:3,waterDurationFactor:1,fertilizerGrowth:1.2,fertilizerYield:2}});
  writeFileSync(join(f.dir,'garden.json'),JSON.stringify(g));t.mock.timers.setTime(start+8*H);
  f.room.setAutonomy(true,Date.now(),!paused);
  const result=f.room.garden('state',{}).garden;
  assert.ok(Math.abs(result.plots[0].progress-(paused?0:2/3))<1e-9);
  assert.equal(result.care.task,null);assert.equal(result.care.queue.length,0);
});
