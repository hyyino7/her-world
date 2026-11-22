import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import {resolveActivityPlayback,sampleActivityPlayback,withHomePlayback} from '../fixtures/playback.js';
import {projectActivityConfig} from '../../src/desktop/platform/activity.js';
import {CompanionBehavior} from '../../src/living/body/plugin.js';
import {emptyHomeState} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
const home=(kind='idle',startedAt=1000)=>({now:2000,her:{kind,spot:'sofa',pose:'stand',activity:'Accepted activity'},behavior:{activityId:'actual-operation',phase:'working',startedAt,bootId:'body'}});

test('both surfaces select complete existing eating, desk and nap assets',()=>{
  for(const [kind,room,desktop] of [['eat','eat_rice','吃白饭'],['desk','desk_code','写代码'],['nap','nap','原地小憩沉眠']]){
    const p=resolveActivityPlayback(home(kind))!;const frame=sampleActivityPlayback(p,2000)!;
    assert.equal(frame.roomClip,room);assert.equal(frame.desktopClip,desktop);assert.equal(p.gap,false);
  }
});
test('progress reads leave a common timeline unchanged; another operation is distinct',()=>{
  const s=home('drink'),p=resolveActivityPlayback(s)!;
  assert.deepEqual(resolveActivityPlayback({...s,now:3000,her:{...s.her,etaMs:12}}),p);
  assert.equal(sampleActivityPlayback(p,3500)!.offsetMs,500);
  assert.notEqual(resolveActivityPlayback({...s,behavior:{...s.behavior,activityId:'new'}})!.key,p.key);
  assert.deepEqual(resolveActivityPlayback({...s,roomOpen:true}),resolveActivityPlayback({...s,roomOpen:false}));
});
test('sleep entry plays once then continues the real sleeping activity',()=>{
  const s=home('sleep');Object.assign(s.her,{asleep:true,spot:'bed'});const p=resolveActivityPlayback(s)!;
  assert.equal(sampleActivityPlayback(p,1100)!.roomClip,'sleep_in');
  const entryEnd=p.startedAt+p.segments[0].durationMs;
  assert.equal(sampleActivityPlayback(p,entryEnd-1)!.roomClip,'sleep_in');
  assert.equal(sampleActivityPlayback(p,entryEnd)!.roomClip,'sleep_loop');
  const later=sampleActivityPlayback(p,entryEnd+1960)!;
  assert.equal(later.roomClip,'sleep_loop');assert.equal(later.offsetMs,1960);
  assert.equal(sampleActivityPlayback(p,86401000)!.roomClip,'sleep_loop');
  assert.equal(s.her.kind,'sleep','Sampling cannot complete the actual sleep');
});
test('unknown historical starts skip entries and synchronize loops without inventing onset',()=>{
  const s=home('sleep',0);Object.assign(s.her,{asleep:true,spot:'bed'});const p=resolveActivityPlayback(s)!;
  assert.equal(p.startedAt,0);assert.equal(sampleActivityPlayback(p,34567)!.roomClip,'sleep_loop');
  assert.equal(sampleActivityPlayback(p,34567)!.offsetMs,sampleActivityPlayback(structuredClone(p),34567)!.offsetMs);
  const reaction=sampleActivityPlayback(resolveActivityPlayback(home('react_happy',0))!,34567)!;
  assert.equal(reaction.complete,true);assert.equal(reaction.mode,'once');
});
test('a completed one-shot holds its final frame until Body changes',()=>{
  const p=resolveActivityPlayback(home('wake'))!,sample=sampleActivityPlayback(p,30000)!;
  assert.equal(sample.roomClip,'sleep_out');assert.equal(sample.complete,true);assert.equal(sample.offsetMs,p.segments[0].durationMs-1);
  assert.equal(sample.nextInMs,undefined);assert.equal(p.kind,'wake');
});
test('reading requires offered content and yields to real movement',()=>{
  const s=home('planned');Object.assign(s.behavior,{presentationKind:'read',readingState:'unread'});
  assert.equal(resolveActivityPlayback(s)!.kind,'reading-wait');
  Object.assign(s.behavior,{readingState:'offered'});assert.equal(resolveActivityPlayback(s)!.kind,'read');
  Object.assign(s.her,{walking:true,runStyle:'hurry'});
  assert.equal(sampleActivityPlayback(resolveActivityPlayback(s)!,2000)!.roomClip,'run_hurry');
});
test('unknown animation retains an explicit gap and never invents a substitute activity',()=>{
  const s=home('bath'),p=resolveActivityPlayback(s)!;
  assert.equal(p.kind,'bath');assert.equal(p.gap,true);assert.match(p.notice!,/缺少/);
  assert.equal(sampleActivityPlayback(p,2000)!.roomClip,'idle');
});
test('garden ownership is explicit and projection neither mutates saved config nor Body',()=>{
  const s=home('garden_water'),cfg={main:{animations:{idle:['idle'],turn:[],clicks:[],events:{},categories:[],moves:{actions:[]}},pets:[{id:'main'}]}};
  const old=JSON.stringify([s,cfg]);const projected=projectActivityConfig(cfg,s);
  assert.equal(projected.main.pets[0].companionPlayback.toolOwner,'clip');
  assert.equal(JSON.stringify([s,cfg]),old);
});

async function bodyFixture(t:TestContext){
  const root=mkdtempSync(join(tmpdir(),'playback-body-')),directory=join(root,'.chatpet/data/life'),now=Date.parse('2026-11-14T03:00:00Z');
  mkdirSync(directory,{recursive:true});t.mock.timers.enable({apis:['Date','setTimeout'],now});
  const s=emptyHomeState(now);Object.assign(s,{room:'living',spot:'sofa',asleep:false,sleepPending:false,route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0}});
  writeFileSync(join(directory,'home.json'),JSON.stringify(s));writeFileSync(join(directory,'garden.json'),JSON.stringify(createGarden(now)));
  const target={id:'world',path:root,sessionIds:[]};
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=> 'storage',runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({displayName:'Fixture'}),store:{meta:()=>undefined}}}} as unknown as PetCoreHost;
  const logger=Object.assign(()=>({warn(){}}),{warn(){}});
  const ctx={logger,on:()=>()=>{},emit(){},get:()=>undefined} as unknown as Context;
  let body=new CompanionBehavior(ctx,host);
  t.after(async()=>{await body.close();rmSync(root,{recursive:true,force:true});});
  await body.setAutonomy('world',true);
  return {get body(){return body;},root,directory,async reopen(){await body.close();body=new CompanionBehavior(ctx,host);await body.setAutonomy('world',true);return body;}};
}
test('real Body observations, immediate care and restart retain one accepted activity',async t=>{
  const f=await bodyFixture(t),acceptedAt=Date.now();
  await f.body.startPlanned('world',{operationId:'quiet',kind:'hold',activity:'Rest quietly'});
  const before=await f.body.roomState('world').then(withHomePlayback),saved=readFileSync(join(f.directory,'home.json'),'utf8');
  assert.equal(JSON.parse(saved).plannedExecutions.quiet.executionStartedAt,acceptedAt);
  assert.equal(before.behavior.animationContext?.startedAt,acceptedAt);
  assert.equal(before.playback!.startedAt,acceptedAt,'A new hold uses its actual persisted execution onset');
  t.mock.timers.setTime(acceptedAt+1250);
  for(let i=0;i<3;i++)assert.equal((await f.body.roomState('world').then(withHomePlayback)).playback!.key,before.playback!.key);
  const water=await f.body.roomAction('world',{action:'water'},'主人');
  assert.equal(withHomePlayback(water.home).playback.key,before.playback!.key);assert.equal(water.home.behavior.activityId,'quiet');
  assert.ok(water.fact,'Care still commits an immediate fact');
  assert.notEqual(readFileSync(join(f.directory,'home.json'),'utf8'),saved);
  const garden=await f.body.garden('world','state');
  if(garden.home)assert.equal(withHomePlayback(garden.home).playback.key,before.playback!.key);
  t.mock.timers.setTime(acceptedAt+2750);
  await f.reopen();const resumed=await f.body.roomState('world').then(withHomePlayback);
  assert.equal(resumed.playback!.activityId,'quiet');assert.equal(resumed.playback!.kind,'rest');
  assert.equal(resumed.behavior.animationContext?.startedAt,acceptedAt);
  assert.equal(resumed.playback!.startedAt,acceptedAt,'Restart retains the original hold onset instead of its new observation time');
  assert.notEqual(resumed.playback!.startedAt,Date.now());
  assert.deepEqual(resumed.playback!.segments,before.playback!.segments);
  const sample=sampleActivityPlayback(resumed.playback!,Date.now())!,uninterrupted=sampleActivityPlayback(before.playback!,Date.now())!;
  assert.equal(sample.roomClip,uninterrupted.roomClip);assert.equal(sample.offsetMs,uninterrupted.offsetMs);
  assert.ok(sample.offsetMs>0,'The resumed loop continues rather than replaying from zero');
});
test('real route exposes its persisted departure, not snapshot time, as visual onset',async t=>{
  const f=await bodyFixture(t);
  await f.body.startPlanned('world',{operationId:'trip',kind:'room',activity:'Go to kitchen',room:'kitchen',spot:'sink'});
  const start=await f.body.roomState('world').then(withHomePlayback);assert.equal(start.playback!.kind,'walk');assert.ok(start.playback!.startedAt>0);
  t.mock.timers.tick(200);const next=await f.body.roomState('world').then(withHomePlayback);
  assert.equal(next.playback!.startedAt,start.playback!.startedAt);assert.equal(next.playback!.key,start.playback!.key);
});

test('a newly perceived head touch uses its real persisted reaction onset',async t=>{
  const f=await bodyFixture(t),result=await f.body.roomAction('world',{action:'pet'},'主人');
  assert.match(result.home.her.kind,/^react_/);
  assert.equal(result.home.behavior.startedAt,Date.now());
  assert.equal(sampleActivityPlayback(withHomePlayback(result.home).playback,Date.now())!.complete,false);
});
