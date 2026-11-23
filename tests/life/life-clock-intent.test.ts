import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Context} from '@deepseek-ai/cordis';
import type {CompanionBehavior} from '../../src/living/body/plugin.js';
import type {PetCoreHost} from '../../src/core/index.js';
import {CompanionLife} from '../../src/living/plan/plugin.js';
import {readLifeControl} from '../../src/living/plan/control-file.js';
import {CompanionRecordLibrary} from '../../src/core/records.js';

function fixture(t:TestContext,enabled?:boolean) {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-13T05:00:00Z')});
  const root=mkdtempSync(join(tmpdir(),'life-clock-intent-')),directory=join(root,'.chatpet/data/life');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  if(enabled!==undefined){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'control.json'),JSON.stringify({version:1,enabled}));}
  const target={id:'world',path:root,sessionIds:[]},order:string[]=[],clockChanges:boolean[]=[];
  const host={native:{},records:{getLibrary:()=>new CompanionRecordLibrary(root,'UTC')},workspace:{status:()=>({state:'ready',target}),
    storageId:()=> 'storage',
    homeScope(){return {workspaceId:target.id,path:target.path,storageId:this.storageId(),bootId:'fixture-boot',generation:0};},
    readCompanionHome:()=>undefined,
    runtime:{identity:()=>({companionId:'fish',displayName:'Fixture'})}}} as unknown as PetCoreHost;
  let life:CompanionLife,row:any,starts=0,resumes=0;
  const body={setAutonomy:async(_workspace:string,value:boolean)=>{clockChanges.push(value);},setReconsiderConditions:async()=>{},
    syncLifeClock:async()=>{},
    inspectPlanned:async(_workspace:string,id:string)=>row?.operationId===id?structuredClone(row):undefined,
    startPlanned:async(_workspace:string,input:any)=>{starts++;row={...input,status:'running',phase:'working',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};return structuredClone(row);},
    pausePlanned:async()=>{row.status='paused';return structuredClone(row);},
    resumePlanned:async()=>{resumes++;order.push('resume');row.status='running';return structuredClone(row);}};
  const ctx={get:(name:string)=>name==='workspaceRegistry'?{get:()=>target}:name==='petBehavior'?body:undefined,
    tools:{register:()=>()=>{}},on:()=>()=>{},effect:()=>()=>{},emit:()=>{},logger:{warn(){}}} as unknown as Context;
  life=new CompanionLife(ctx,host,'standard',{body:()=>body as unknown as CompanionBehavior});
  (life as any).startRuntime=async()=>{order.push('native-start');throw Error('scripted native home unavailable');};
  t.after(()=>life.close());
  return {life,root,directory,body,order,clockChanges,get starts(){return starts;},get resumes(){return resumes;}};
}

test('synchronous body clock discovery creates no missing directories or control file',t=>{
  const f=fixture(t);
  assert.deepEqual(f.life.bodyClockState('world'),{enabled:false,restoreElapsed:false});
  assert.equal(f.life.bodyClockState('other'),undefined);
  assert.equal(existsSync(join(f.root,'.chatpet')),false);
});

test('persisted enabled intent restores elapsed time before the native planner is ready',async t=>{
  const f=fixture(t,true),before=readFileSync(join(f.directory,'control.json'),'utf8');
  assert.deepEqual(f.life.bodyClockState('world'),{enabled:true,restoreElapsed:true});assert.equal(f.life.running(),false);
  await (f.life as any).synchronize();
  await assert.rejects((f.life as any).tick(),/native home unavailable/);
  assert.deepEqual(f.life.bodyClockState('world'),{enabled:true,restoreElapsed:true});
  assert.deepEqual(f.clockChanges,[],'Planner startup failure does not disable the accepted body clock');
  assert.equal(readFileSync(join(f.directory,'control.json'),'utf8'),before);
});

test('explicit owner disable and re-enable do not catch up the paused interval',async t=>{
  const f=fixture(t,true);await f.life.control('world',false);
  const intent=()=>{
    const {enabled,restoreElapsed}=f.life.bodyClockState('world')!;
    return {enabled,restoreElapsed};
  };
  assert.deepEqual(intent(),{enabled:false,restoreElapsed:false});
  const expectedPauses=[{from:Date.now(),to:null}];
  assert.deepEqual(f.life.bodyClockState('world')?.pauses,expectedPauses);
  assert.deepEqual(readLifeControl(f.root)?.pauses,expectedPauses);
  t.mock.timers.tick(60*60_000);
  await assert.rejects(f.life.control('world',true),/native home unavailable/);
  assert.deepEqual(intent(),{enabled:true,restoreElapsed:false});
  assert.equal(JSON.parse(readFileSync(join(f.directory,'control.json'),'utf8')).enabled,true);
  assert.deepEqual(f.clockChanges,[false]);
});

test('previously accepted work resumes on its original receipt before native startup',async t=>{
  const f=fixture(t,true);await (f.life as any).synchronize();const plan=(f.life as any).binding.plan;
  await plan.commit(0,{goal:'Rest',reason:'Keep an accepted quiet activity',steps:[{id:'rest',kind:'hold',activity:'Resting'}],nextConsiderAt:null},f.body,'world');
  await plan.advance('world',f.body);const original=plan.read().plan.operationId;
  await plan.control(plan.read().revision,'pause','Owner paused Life',f.body,'world');plan.markAutoResume(true);
  f.order.length=0;await assert.rejects((f.life as any).tick(),/native home unavailable/);
  assert.equal(f.resumes,1);assert.equal(f.starts,1);assert.deepEqual(f.order,['resume','native-start']);
  const current=plan.read().plan;assert.equal(current.operationId,original);assert.equal(current.status,'active');assert.equal(current.resumeOnEnable,false);
});

test('invalid saved clock controls are reported without silently rewriting them',t=>{
  const f=fixture(t,true),file=join(f.directory,'control.json'),invalid='{"version":1,"enabled":"yes"}';writeFileSync(file,invalid);
  assert.throws(()=>f.life.bodyClockState('world'),/开关文件无效/);assert.equal(readFileSync(file,'utf8'),invalid);
});

test('the standalone control reader distinguishes missing data, legacy intent and recorded pauses',t=>{
  const f=fixture(t),file=join(f.directory,'control.json');
  assert.equal(readLifeControl(f.root),undefined);
  assert.equal(existsSync(join(f.root,'.chatpet')),false);
  mkdirSync(f.directory,{recursive:true});
  assert.equal(readLifeControl(f.root),undefined);
  assert.equal(existsSync(file),false);
  writeFileSync(file,JSON.stringify({version:1,enabled:false}));
  assert.equal(readLifeControl(f.root)?.enabled,false);
  assert.equal(readLifeControl(f.root)?.pauses,undefined);
  for (const [enabled,pauses] of [
    [false,[{from:10,to:null}]],
    [true,[{from:10,to:20}]],
  ] as const) {
    const raw=JSON.stringify({version:1,enabled,pauses});
    writeFileSync(file,raw);
    const saved=readLifeControl(f.root);
    assert.equal(saved?.enabled,enabled);
    assert.deepEqual(saved?.pauses,pauses);
    assert.equal(readFileSync(file,'utf8'),raw);
  }
});

test('the standalone control reader reports malformed files and invalid pause history',t=>{
  const f=fixture(t,true),file=join(f.directory,'control.json');
  for (const raw of ['{','null','{"version":2,"enabled":true}',
    '{"version":1,"enabled":true,"pauses":[{"from":10,"to":null}]}']) {
    writeFileSync(file,raw);
    assert.throws(()=>readLifeControl(f.root),/生活开关文件无效/);
    assert.equal(readFileSync(file,'utf8'),raw);
  }
});

test('clock discovery tolerates invalid preferences while Life refuses to bind or rewrite them',async t=>{
  const f=fixture(t,true),file=join(f.directory,'control.json');
  const raw='{"version":1,"enabled":true,"pauses":[],"preferences":null}';
  writeFileSync(file,raw);
  assert.deepEqual(readLifeControl(f.root),{enabled:true,pauses:[]});
  assert.deepEqual(f.life.bodyClockState('world'),{enabled:true,restoreElapsed:true,pauses:[]});
  await assert.rejects(f.life.control('world',false),/生活设置无效/);
  assert.equal(readFileSync(file,'utf8'),raw);
});
