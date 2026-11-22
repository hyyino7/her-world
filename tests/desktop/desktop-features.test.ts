import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {createCore} from '../../src/core/index.js';
import {DesktopFeatures} from '../../src/desktop/features.js';
import type {TestContext} from 'node:test';
import type {PetCoreHost} from '../../src/core/index.js';
import {DEFAULT_COMPANION_SETTINGS,type CompanionSettings} from '../../src/core/companion-settings.js';
import {mountLivingArea} from '../../src/living/index.js';
import type {CompanionLife} from '../../src/living/plan/plugin.js';

async function planLease(host:PetCoreHost, running:()=>boolean) {
  const root = new Context();
  await root.plugin(scope => {
    mountLivingArea(scope,host,'plan',()=>({bodyClockState:()=>undefined,running}) as unknown as CompanionLife,
      ()=>{},()=>{});
  });
  return root;
}

test('upstream Desktop todos survive restart; malformed data is preserved; native whisper and unsupported balance are explicit',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-features-'))),repo=join(root,'repo');mkdirSync(repo);
  // Initialization now verifies the portable Repo-owned Core database. Keep the
  // disposable fixture under that same ownership boundary as an installed pet.
  const host=createCore({dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'scope',ownerActorId:'owner',displayName:'Fish',character:'Preserved personality.'});
  const ok=(r:any)=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  const prefs=ok(await host.services.preferences.read(host.operator.request('read'),{}));
  const saved=ok(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:prefs.revision,workspace:{id:'repo',path:repo,title:'repo'},conversation:prefs.conversation}));
  ok(await host.services.workspace.initialize(host.operator.request('init'),{expectedPreferencesRevision:saved.revision}));
  const configured=host.workspace.companionConfiguration();
  ok(await host.services.workspace.saveCompanion(host.operator.request('fixture-images'),{workspaceId:'repo',expectedSettings:configured,settings:{...configured,desktopWhisperImageEnabled:true}}));
  const frames:{type:string;value:any}[]=[];let calls=0;let lifeRunning=false;let sleeping=false;
  const bodyRequests:string[]=[];
  // Actual pending/arrival sleep transitions are covered by life-body.test.ts.
  // This fixture verifies the feature adapter's public Behavior delegation.
  const behavior={
    restState(id:string){assert.equal(id,'repo');return {sleeping,pending:false};},
    async act(id:string,action:string){
      assert.equal(id,'repo');assert.ok(action==='sleep'||action==='wake');bodyRequests.push(action);
      const next=action==='sleep',changed=next!==sleeping;sleeping=next;
      return {changed,home:{her:{activity:sleeping?'正在睡觉':'醒来了'}}};
    },
  };
  const lifetime = await planLease(host,()=>lifeRunning);
  const ctx={root:lifetime,[Context.isolate]:lifetime[Context.isolate],get(name:string){
    if(name==='petBehavior')return behavior;
    if(name==='agentDefaultModel')return {currentSelection:()=>({provider:'fixture',model:'local'})};
    if(name==='llm')return {async *stream(options:any){calls++;assert.match(options.system,/Preserved personality/);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'今天也慢慢来。'};yield {type:'block-end',index:0,block:{type:'text',text:'今天也慢慢来。'}};yield {type:'finish',reason:{kind:'stop'}};}};
  },logger:()=>({warn(){},info(){}})} as unknown as Context;
  const make=()=>new DesktopFeatures(ctx,host,(type,value)=>frames.push({type,value}),()=>true,()=>false);
  let features=make();
  try {
    const result=await features.request({path:'/todos',method:'POST',body:JSON.stringify({text:'Finish the sample',dueAt:Date.now()+60000})});
    assert.equal(result.ok,true);assert.equal(result.todo.text,'Finish the sample');
    await features.close();features=make();
    const list=await features.request({path:'/todos',method:'GET'});assert.equal(list.todos.length,1);
    const patch=await features.request({path:'/todos/'+result.todo.id,method:'PATCH',body:'{"done":true}'});assert.equal(patch.todo.done,true);
    assert.equal((await features.whisper()).ok,true);assert.equal(calls,1);assert.equal(frames.find(x=>x.type==='say')?.value.text,'今天也慢慢来。');
    assert.equal(frames.at(-1)?.value.whisper, true);
    assert.ok(frames.at(-1)?.value.sticker, 'Automatic illustration comes from the actual sticker catalog');
    assert.equal((await features.balance()).reason,'unsupported');assert.equal(calls,1);
    await features.request({path:'/sleep',method:'POST'});await assert.rejects(features.whisper(),/睡觉/);
    await features.request({path:'/wake',method:'POST'});
    await features.request({path:'/todos/'+result.todo.id,method:'PATCH',body:JSON.stringify({done:false,dueAt:Date.now()-1})});
    await features['tick']();assert.equal(frames.filter(f=>f.type==='say'&&f.value.reminder).length,1);
    await features['tick']();assert.equal(frames.filter(f=>f.type==='say'&&f.value.reminder).length,1,'reminder acknowledgement prevents duplicates');
    const old=host.workspace.companionConfiguration();
    ok(await host.services.workspace.saveCompanion(host.operator.request('enable-auto'),{workspaceId:'repo',expectedSettings:old,settings:{...old,desktopWhisperEnabled:true}}));
    const now=Date.now();t.mock.timers.enable({apis:['Date'],now});t.mock.timers.tick(5*60_000+1);
    const policy=host.workspace.runtime.policy();host.workspace.runtime.store.put('policy','current',{...policy,quiet:true});
    await features['tick']();assert.equal(calls,1,'quiet suppresses automatic inference');
    host.workspace.runtime.store.put('policy','current',policy);
    lifeRunning=true;await features['tick']();assert.equal(calls,1,'Life suppresses automatic whisper inference');
    lifeRunning=false;await features['tick']();assert.equal(calls,2,'one scheduled native inference');
    await features['tick']();assert.equal(calls,2,'interval prevents repeated inference');
    const timed = host.workspace.companionConfiguration();
    ok(await host.services.workspace.saveCompanion(host.operator.request('whisper-options'),{workspaceId:'repo',expectedSettings:timed,
      settings:{...timed,desktopWhisperImageEnabled:false,desktopSleepTalkSeconds:30}}));
    assert.ok(!(await features.whisper()).image);
    assert.equal((await features.whisper('praise')).image,'praise','An explicitly chosen image has priority');
    await features.request({path:'/sleep',method:'POST'});
    t.mock.timers.tick(29_999);
    const beforeDream = calls;
    await features['tick'](); assert.equal(calls, beforeDream);
    t.mock.timers.tick(1);
    await features['tick'](); assert.equal(calls,beforeDream+1);
    assert.deepEqual([frames.at(-1)?.value.dream,frames.at(-1)?.value.whisper,frames.at(-1)?.value.sticker],[true,false,undefined]);
    await features.request({path:'/wake',method:'POST'});
    t.mock.timers.reset();
    assert.deepEqual(bodyRequests,['sleep','wake','sleep','wake']);
    const file=join(repo,'.chatpet/data/desktop/todos.json');writeFileSync(file,'broken original');
    await assert.rejects(features.request({path:'/todos',method:'POST',body:'{"text":"cannot overwrite"}'}));assert.equal(readFileSync(file,'utf8'),'broken original');
  } finally {t.mock.timers.reset();await features.close();await lifetime.fiber.dispose();await host.close();rmSync(root,{recursive:true,force:true});}
});

async function maintenanceFixture(t:TestContext) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-deadline-'))),events=new Map<string,Set<(...args:any[])=>void>>();
  const now=new Date('2026-11-13T02:00:00Z').getTime();
  t.mock.timers.enable({apis:['Date','setTimeout'],now});
  let settings:CompanionSettings={...DEFAULT_COMPANION_SETTINGS,desktopWhisperEnabled:false,desktopBalanceEnabled:false};
  let sleeping=false,quiet=false,busy=false,visible=true,lifeRunning=false,calls=0;
  const frames:{type:string;value:any}[]=[];
  const homeScope=()=>({workspaceId:'fixture',path:root,storageId:'fixture',bootId:'fixture-workspace',generation:1});
  const host={workspace:{status:()=>({state:'ready',target:{id:'fixture',path:root}}),companionSettings:()=>settings,
    homeScope,runtime:{policy:()=>({quiet}),identity:()=>({displayName:'Fixture'})}},native:{context:()=>({identity:'Fixture identity'})}} as unknown as PetCoreHost;
  const lifetime = await planLease(host,()=>lifeRunning);
  const ctx={root:lifetime,[Context.isolate]:lifetime[Context.isolate],get(name:string){
    if(name==='petBehavior')return {restState:()=>({sleeping,pending:false})};
    if(name==='agentDefaultModel')return {currentSelection:()=>({provider:'fixture',model:'local'})};
    if(name==='llm')return {async *stream(){calls++;yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'A fixture thought.'};yield {type:'block-end',index:0,block:{type:'text',text:'A fixture thought.'}};yield {type:'finish',reason:{kind:'stop'}};}};
  },on(name:string,fn:(...args:any[])=>void){const listeners=events.get(name)??new Set();listeners.add(fn);events.set(name,listeners);return()=>{listeners.delete(fn);};},logger:()=>({warn(){},info(){}})} as unknown as Context;
  const features=new DesktopFeatures(ctx,host,(type,value)=>frames.push({type,value}),()=>visible,()=>busy);
  const emit=(name:string,...args:any[])=>{for(const fn of events.get(name)??[])fn(...args);};
  const settled=async()=>{await features['maintenance'];await features['scheduling'];};
  t.after(async()=>{await features.close();await lifetime.fiber.dispose();t.mock.timers.reset();rmSync(root,{recursive:true,force:true});});
  return {root,features,frames,events,emit,settled,homeScope,calls:()=>calls,
    configure(next:Partial<typeof settings>){settings={...settings,...next};emit('pet/core.changed','workspace.saveCompanion');},
    sleep(value:boolean){sleeping=value;emit('world.changed',{...homeScope(),bodyOnly:true});},
    quiet(value:boolean){quiet=value;emit('pet/core.changed','preferences.setQuiet');},
    busy(value:boolean){busy=value;emit('session/event',{header:{cwd:root}},{type:value?'turn/start':'turn/end'});},
    visible(value:boolean){visible=value;features.restore(false);},
    life(value:boolean){lifeRunning=value;emit('world.changed',homeScope());},
    async advance(ms:number){t.mock.timers.tick(ms);await settled();},
  };
}

test('maintenance has no idle poll and wakes at the original todo reminder deadline',async t=>{
  const f=await maintenanceFixture(t);await f.features.refresh();
  const tick=t.mock.method(f.features as any,'tick',f.features['tick'].bind(f.features));
  assert.equal(f.features['timer'],undefined);
  await f.advance(60*60_000);assert.equal(tick.mock.callCount(),0);
  await f.features.request({path:'/todos',method:'POST',body:JSON.stringify({text:'Deadline fixture',dueAt:Date.now()+60_000})});
  await f.advance(59_999);assert.equal(tick.mock.callCount(),0);
  await f.advance(1);assert.equal(tick.mock.callCount(),1);
  assert.equal(f.frames.filter(frame=>frame.value.reminder).length,1);
  await f.advance(1000);assert.equal(tick.mock.callCount(),1,'Reminder acknowledgement does not cause a per-second maintenance loop');
});

test('a far-future todo wakes when the original policy first admits it, without daily polling',async t=>{
  const f=await maintenanceFixture(t);await f.features.refresh();
  const tick=t.mock.method(f.features as any,'tick',f.features['tick'].bind(f.features));
  const day=24*60*60_000;
  await f.features.request({path:'/todos',method:'POST',body:JSON.stringify({text:'Far future fixture',dueAt:Date.now()+10*day})});
  await f.advance(3*day-1);assert.equal(tick.mock.callCount(),0);
  await f.advance(1);assert.equal(tick.mock.callCount(),1);
  assert.equal(f.frames.filter(frame=>frame.value.reminder).length,1);
});

test('settings, Life ownership, busy and quiet changes rearm one deadline without a parallel inference chain',async t=>{
  const f=await maintenanceFixture(t);await f.features.refresh();
  f.life(true);f.configure({desktopWhisperEnabled:true,desktopWhisperMinutes:1});await f.settled();
  assert.equal(f.features['timer'],undefined);
  await f.advance(20*60_000);assert.equal(f.calls(),0,'Life owns autonomous speech');
  f.life(false);await f.settled();await f.advance(1);assert.equal(f.calls(),1);
  f.busy(true);await f.settled();assert.equal(f.features['timer'],undefined);
  await f.advance(60_000);assert.equal(f.calls(),1);
  f.busy(false);await f.settled();await f.advance(1);assert.equal(f.calls(),2);
  f.quiet(true);await f.settled();assert.equal(f.features['timer'],undefined);
  await f.advance(60_000);assert.equal(f.calls(),2);
  f.quiet(false);await f.settled();await f.advance(1);assert.equal(f.calls(),3);
  f.configure({desktopWhisperMinutes:3});await f.settled();
  await f.advance(179_999);assert.equal(f.calls(),3);
  await f.advance(1);assert.equal(f.calls(),4);
});

test('sleep, visibility and close preserve balance/dream semantics while cancelling unused deadlines',async t=>{
  const f=await maintenanceFixture(t);await f.features.refresh();let balances=0;
  t.mock.method(f.features,'balance',async()=>{balances++;return {ok:false,reason:'fixture'};});
  f.configure({desktopWhisperEnabled:true,desktopWhisperMinutes:1,desktopSleepTalkSeconds:30,desktopBalanceEnabled:true,desktopBalanceMinutes:1});
  f.sleep(true);await f.settled();await f.advance(29_999);assert.equal(f.calls(),0);assert.equal(balances,0);
  await f.advance(1);assert.equal(f.calls(),1);assert.equal(balances,0);
  assert.equal(f.frames.at(-1)?.value.dream,true);
  f.visible(false);await f.settled();assert.equal(f.features['timer'],undefined);
  await f.advance(60_000);assert.equal(f.calls(),1);assert.equal(balances,0);
  f.visible(true);f.sleep(false);f.life(true);await f.settled();await f.advance(1);
  assert.equal(balances,1,'Awake balance refresh retains its actual elapsed period');
  assert.equal(f.calls(),1,'Life still suppresses both old whisper and dream schedules');
  await f.features.close();assert.equal(f.features['timer'],undefined);
  assert.ok([...f.events.values()].every(listeners=>listeners.size===0));
  await f.advance(5*60_000);assert.equal(balances,1);assert.equal(f.calls(),1);
});

test('a failed due action waits for a real lifecycle change instead of retrying a hot timer',async t=>{
  const f=await maintenanceFixture(t);await f.features.refresh();let attempts=0;
  t.mock.method(f.features,'whisper',async()=>{attempts++;throw Error('injected missing resource');});
  f.configure({desktopWhisperEnabled:true,desktopWhisperMinutes:1});await f.settled();
  await f.advance(60_000);assert.equal(attempts,1);assert.equal(f.features['timer'],undefined);
  await f.advance(60*60_000);assert.equal(attempts,1);
  f.emit('world.changed',{...f.homeScope(),generation:0});await f.settled();await f.advance(1);assert.equal(attempts,1);
  f.emit('world.changed',f.homeScope());await f.settled();await f.advance(1);assert.equal(attempts,2);
});
