import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import type {CompanionBehavior} from '../../src/living/body/plugin.js';
import type {PetCoreHost} from '../../src/core/index.js';
import {DEFAULT_COMPANION_SETTINGS} from '../../src/core/companion-settings.js';
import {CompanionRecordLibrary} from '../../src/core/records.js';
import {CompanionLife} from '../../src/living/plan/plugin.js';
import {DesktopFeatures} from '../../src/desktop/features.js';
import {mountLivingArea} from '../../src/living/index.js';
import {registerLifeOutlet} from '../../src/living/outlets.js';

/** Real Life admission and Desktop scheduling/whisper implementation. Only the
 * native session provider, body presentation and model stream are external fakes. */
async function fixture(t:TestContext,enabled:boolean,sleeping=false) {
  const root=mkdtempSync(join(tmpdir(),'life-desktop-integration-'));
  const directory=join(root,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'control.json'),JSON.stringify({version:1,enabled}));
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-13T05:00:00Z')});
  const target={id:'fixture-world',path:root,sessionIds:[]};
  const settings={...DEFAULT_COMPANION_SETTINGS,desktopWhisperEnabled:true,desktopWhisperMinutes:1,
    desktopSleepTalkSeconds:30,desktopWhisperImageEnabled:false,desktopBalanceEnabled:false};
  const frames:{type:string;value:any}[]=[],warnings:unknown[]=[];
  const events=new Map<string,Set<(...args:any[])=>unknown>>();
  const emit=(name:string,...args:any[])=>{for(const fn of events.get(name)??[])fn(...args);};
  let calls=0,nativeOpens=0,features!:DesktopFeatures,life!:CompanionLife;
  const host={native:{context:()=>({identity:'Fixture companion'})},records:{getLibrary:()=>new CompanionRecordLibrary(root,'UTC')},
    workspace:{status:()=>({state:'ready',target}),storageId:()=> 'fixture-storage',companionSettings:()=>settings,
      homeScope(){return {workspaceId:target.id,path:target.path,storageId:this.storageId(),bootId:'fixture-boot',generation:0};},
      readCompanionHome:()=>undefined,
      runtime:{config:{companionId:'fixture-fish',ownerActorId:'fixture-owner'},identity:()=>({companionId:'fixture-fish',displayName:'Fixture'}),policy:()=>({quiet:false})}}} as unknown as PetCoreHost;
  const body={restState:()=>({sleeping,pending:false}),setAutonomy:async()=>{},setReconsiderConditions:async()=>{},syncLifeClock:async()=>{}};
  const controller={async create(){nativeOpens++;throw Error('Fixture native session provider is unavailable');},cancel(){}};
  const logger=Object.assign(()=>({warn(...args:unknown[]){warnings.push(args);},info(){},error(){},debug(){}}),{warn(){},error(){}});
  const lifetime = new Context();
  const context = (scope:Context) => ({root:scope.root,[Context.isolate]:scope[Context.isolate],get(name:string){
    if(name==='petBehavior')return body;
    if(name==='workspaceRegistry')return {get:()=>target,archivedSessionIds:[]};
    if(name==='sessionController')return controller;
    if(name==='agentDefaultModel')return {currentSelection:()=>({provider:'fixture',model:'local'})};
    if(name==='llm')return {async *stream(){calls++;
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text:'A fixture thought.'};
      yield {type:'block-end',index:0,block:{type:'text',text:'A fixture thought.'}};
      yield {type:'finish',reason:{kind:'stop'}};}};
  },on(name:string,fn:(...args:any[])=>unknown){const list=events.get(name)??new Set();list.add(fn);events.set(name,list);return()=>{list.delete(fn);};},
    emit,logger,tools:{register:()=>()=>{}},effect:()=>()=>{}} as unknown as Context);
  t.after(async()=>{await lifetime.fiber.dispose();t.mock.timers.reset();rmSync(root,{recursive:true,force:true});});
  await lifetime.plugin(scope => {
    mountLivingArea(scope,host,'body',()=>body as unknown as CompanionBehavior,()=>{},()=>{});
  });
  await lifetime.plugin(scope => {
    mountLivingArea(scope,host,'plan',view=>life=new CompanionLife(context(scope),host,'standard',view),
      value=>value.activate());
  });
  await lifetime.plugin(scope => {
    features=new DesktopFeatures(context(scope),host,(type,value)=>frames.push({type,value}),()=>true,()=>false);
    scope.effect(()=>()=>features.close());
    scope.effect(()=>registerLifeOutlet(scope,host,'desktop',{
      pause:()=>features.pause(),restore:()=>features.restore(false),present:()=>false,
    }).revoke);
  });
  const settled=async()=>{for(let pass=0;pass<8;pass++){await life['serial'];await features['maintenance'];await features['scheduling'];await Promise.resolve();}};
  t.mock.timers.tick(0);await settled();await features.refresh();
  return {life,features,frames,warnings,directory,settled,calls:()=>calls,nativeOpens:()=>nativeOpens,
    async advance(ms:number){t.mock.timers.tick(ms);await settled();}};
}

for(const sleeping of [false,true]) {
  const activity=sleeping?'dream':'whisper';
  test(`enabled Life with unavailable native execution suppresses automatic Desktop ${activity}`,async t=>{
    const f=await fixture(t,true,sleeping);
    assert.equal(f.life.running(),false);
    assert.deepEqual(f.life.bodyClockState('fixture-world'),{enabled:true,restoreElapsed:true});
    assert.ok(f.nativeOpens()>0,'The actual native opener failed rather than a mocked Life running flag');
    assert.equal(f.features['timer'],undefined,'Pending Life ownership cannot schedule a parallel inference deadline');
    await f.advance(20*60_000);
    await f.features['tick']();await f.settled();
    assert.equal(f.calls(),0,'Even an already-due maintenance action cannot bypass retained Life intent');
    assert.equal(f.frames.filter(frame=>frame.value.whisper||frame.value.dream).length,0);
  });

  test(`explicit Life disable restores the existing optional Desktop ${activity} once`,async t=>{
    const f=await fixture(t,true,sleeping);
    await f.life.control('fixture-world',false);await f.settled();
    assert.equal(f.life.bodyClockState('fixture-world')?.enabled,false);
    await f.advance((sleeping?30:60)*1000);
    assert.equal(f.calls(),1);
    const result=f.frames.find(frame=>frame.type==='say'&&frame.value[activity]);
    assert.ok(result,'The original upstream generation and presentation path is still used');
    await f.features['tick']();assert.equal(f.calls(),1,'The original interval prevents repeated automatic inference');
    assert.equal(JSON.parse(readFileSync(join(f.directory,'control.json'),'utf8')).enabled,false);
  });
}

test('failed native activation cancels a previously scheduled Desktop inference deadline',async t=>{
  const f=await fixture(t,false);
  assert.ok(f.features['timer']);
  await assert.rejects(f.life.control('fixture-world',true),/native session provider is unavailable/);
  await f.settled();
  assert.equal(f.life.running(),false);assert.equal(f.life.bodyClockState('fixture-world')?.enabled,true);
  assert.equal(f.features['timer'],undefined);
  await f.advance(5*60_000);await f.features['tick']();assert.equal(f.calls(),0);
});

test('pending Life ownership still permits deterministic Desktop todo reminders',async t=>{
  const f=await fixture(t,true);
  const added=await f.features.request({path:'/todos',method:'POST',body:JSON.stringify({text:'Fixture reminder',dueAt:Date.now()+60_000})});
  assert.equal(added.ok,true);
  await f.advance(60_000);
  assert.equal(f.frames.filter(frame=>frame.type==='say'&&frame.value.reminder).length,1);
  assert.equal(f.calls(),0,'A deterministic reminder does not require another autonomous model chain');
  await f.features['tick']();assert.equal(f.frames.filter(frame=>frame.value.reminder).length,1);
});
