import {roomReaders} from '../fixtures/room-readers.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Guard the external app/network seams before importing the actual carrier.
// ensure() registers its real listener; no presentation helper may be launched.
const forbidden=[],restore=[];
function block(object,key) {
  const prior=object[key];restore.push(()=>{object[key]=prior;});
  object[key]=()=>{forbidden.push(key);throw Error('Forbidden test app/network operation: '+key);};
}
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])block(childProcess,key);
for(const [object,keys] of [[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
  [net.Server.prototype,['listen']],[http,['request','get']],[https,['request','get']],[tls,['connect']],[globalThis,['fetch']]])
  for(const key of keys)block(object,key);
syncBuiltinESMExports();
after(()=>{for(const undo of restore.reverse())undo();syncBuiltinESMExports();assert.deepEqual(forbidden,[]);});

const {PetPlatform}=await import(compiledURL('desktop/platform/plugin.js'));
const {CompanionBehavior}=await import(compiledURL('living/body/plugin.js'));
const {DEFAULT_COMPANION_SETTINGS}=await import(compiledURL('core/companion-settings.js'));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const snapshot=(revision=1,bootId='fixture-boot',label='Quiet rest')=>({
  her:{kind:'idle',activity:label,asleep:false},body:{energy:.8},
  behavior:{bootId,revision,activityId:null,kind:'idle',phase:'idle'},
});

async function fixture(t,{real=false,direct=false,lifecycle=false}={}) {
  const root=mkdtempSync(join(tmpdir(),'mapped-refresh-'));
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T05:00:00Z')});
  let target={id:'a',path:join(root,'a')},current=snapshot(),hook,reads=0,guardTrips=0,body,platform;
  const listeners=new Map(),fibers=[],warnings=[];
  const makeWorkspace=()=>{const dir=join(target.path,'.chatpet/data/pet-platform');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'main-config.jsonc'),'{"pets":[]}');};
  makeWorkspace();
  const services={petLife:{running:()=>true,bodyClockState:()=>({enabled:true,restoreElapsed:false})}};
  const host={native:{},workspace:{status:()=>({state:'ready',target}),storageId:()=>target.id,
    companionSettings:()=>structuredClone(DEFAULT_COMPANION_SETTINGS),
    sessionStatus:session=>session?.header?.cwd===target.path?{state:'ready',target}:null,
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({displayName:'Fixture',companionId:'fish',character:''}),
      store:{meta:()=>undefined,get(){},put(){}}}}};
  const logger=Object.assign(()=>logger,{warn:(...args)=>warnings.push(args),info(){},error(){},debug(){}});
  const emit=(name,...args)=>{for(const listener of [...listeners.get(name)??[]])listener(...args);};
  const ctx={petCore:host,petDesktop:{chat:{id:'native-session'},features:{restore(){}}},logger,
    connection:{broadcast(){}},webServer:{getOrigin:()=> 'http://127.0.0.1'},
    get:name=>name==='petDesktop'?ctx.petDesktop:services[name],
    on(name,listener){const set=listeners.get(name)??new Set();listeners.set(name,set);set.add(listener);return()=>set.delete(listener);},emit,
    effect:()=>()=>{},
  };
  if(lifecycle)ctx.inject=(names,apply)=>{
    const fiber={stops:[],mount(){const scope={...ctx,effect:setup=>{const stop=setup();if(stop)this.stops.push(stop);}};apply(scope);},
      dispose(){for(const stop of this.stops.splice(0))stop();}};
    if(names.length===1&&names[0]==='petBehavior'){fibers.push(fiber);if(services.petBehavior)fiber.mount();}
    return fiber;
  };
  if(real){body=new CompanionBehavior(ctx,host,{plan:()=>services.petLife});await body.snapshot(target.id);await body.setAutonomy(target.id,true);}
  const actualRoomState=body?.roomState.bind(body);
  const service={async roomState(id){
    reads++;
    // A failed implementation must terminate the fixture instead of starving
    // the test worker. This guard observes actual ensure() listener recursion.
    if(reads>24){guardTrips++;platform.close();throw Error('Body refresh did not converge');}
    if(hook)return hook(id);
    if(actualRoomState){t.mock.timers.setTime(Date.now()+1);return actualRoomState(id);}
    return structuredClone(current);
  }};
  services.petBehavior=direct?body:service;
  platform=new PetPlatform(ctx);
  const drain=async()=>{
    for(let pass=0;pass<12;pass++){
      await platform.refreshing;await body?.serial;await Promise.resolve();
      if(!platform.refreshing)return;
    }
    assert.fail('The actual platform refresh did not settle');
  };
  const changed=(revision,bootId='fixture-boot',reason='observation',workspaceId=target.id)=>emit('pet/behavior.changed',{workspaceId,bootId,revision,reason});
  t.after(async()=>{platform.close();await body?.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:20});assert.equal(guardTrips,0,'The event delivery guard must never stop a refresh pump');assert.deepEqual(forbidden,[]);});
  platform.ownerAccess(target.id);await drain();
  assert.ok((listeners.get('pet/behavior.changed')?.size??0)>0,'The actual ensure() path registered its listener');
  return {platform,body,service,services,ctx,fibers,warnings,drain,changed,
    get reads(){return reads;},get target(){return target;},setHook:fn=>{hook=fn;},setCurrent:value=>{current=value;},
    rebind(id){target={id,path:join(root,id)};makeWorkspace();platform.ownerAccess(id);},
    unload(){services.petBehavior=undefined;for(const fiber of fibers)fiber.dispose();},
    reload(next=service){services.petBehavior=next;for(const fiber of fibers)fiber.mount();},
  };
}

async function atReadTail(platform,apply) {
  let entered=false;
  for(let pass=0;pass<40;pass++) {
    await Promise.resolve();entered ||= Boolean(platform.behaviorRead);
    if(entered && !platform.behaviorRead && platform.refreshing) {
      // Let the do/while continuation decide to exit before delivering another
      // event, while its owning promise has not run its final cleanup yet.
      await Promise.resolve();
      assert.ok(platform.refreshing);assert.equal(platform.behaviorRead,undefined);
      apply();return;
    }
  }
  assert.fail('The actual read did not expose its settling window');
}

test('actual ensure and Body: an observation-producing roomState converges, while an external observation still refreshes',async t=>{
  const f=await fixture(t,{real:true});
  assert.equal(f.reads,1,'The snapshot observation is already covered by its own returned projection');
  const reads=f.reads;await f.platform.refreshBehavior();await f.drain();assert.equal(f.reads,reads+1);
  f.body.binding.room.state.needs.thirst+=.02;
  t.mock.timers.setTime(Date.now()+100);await f.body.snapshot(f.target.id);await f.drain();
  assert.equal(f.reads,reads+2,'An external Body snapshot still causes one platform read');
  assert.equal(f.platform.behavior.behavior.revision,f.body.revision);
});

test('actual listener: a synchronous covered observation cannot enter a second refresh before promise ownership is installed',async t=>{
  const f=await fixture(t),before=f.reads;
  f.setHook(()=>{f.changed(2);return snapshot(2);});
  await f.platform.refreshBehavior();await f.drain();
  assert.equal(f.reads,before+1);assert.equal(f.platform.behavior.behavior.revision,2);
});

for(const changedBoot of [false,true])test('actual listener: an in-flight '+(changedBoot?'different-boot':'newer')+' observation gets a follow-up read',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred(),before=f.reads;
  const boot=changedBoot?'replacement-boot':'fixture-boot';let first=true;
  f.setHook(()=>{if(first){first=false;entered.resolve();return release.promise;}f.changed(3,boot);return snapshot(3,boot);});
  const refreshing=f.platform.refreshBehavior();await entered.promise;
  f.changed(2);f.changed(3,boot);release.resolve(snapshot(2));
  await refreshing;await f.drain();assert.equal(f.reads,before+2);
  assert.deepEqual(f.platform.behavior.behavior,snapshot(3,boot).behavior);
});

test('actual listener: unknown observation metadata conservatively requests another read',async t=>{
  const f=await fixture(t),before=f.reads;let first=true;
  f.setHook(()=>{if(first){first=false;f.ctx.emit('pet/behavior.changed',{workspaceId:'a',reason:'observation'});}else f.changed(2);return snapshot(2);});
  await f.platform.refreshBehavior();await f.drain();assert.equal(f.reads,before+2);
});

for(const trigger of ['transition','explicit'])test('actual listener: '+trigger+' requests during a covered observation retain the original coalesced follow-up',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred(),before=f.reads;let first=true;
  f.setHook(()=>{if(first){first=false;entered.resolve();return release.promise;}f.changed(3);return snapshot(3);});
  const refreshing=f.platform.refreshBehavior();await entered.promise;f.changed(2);
  if(trigger==='transition')f.changed(3,'fixture-boot','transition');
  else {void f.platform.refreshBehavior();void f.platform.refreshBehavior();}
  release.resolve(snapshot(2));await refreshing;await f.drain();
  assert.equal(f.reads,before+2);assert.equal(f.platform.behavior.behavior.revision,3);
});

test('actual optional-service callbacks retain unload and reload refreshes',async t=>{
  const f=await fixture(t,{lifecycle:true}),before=f.reads;
  f.unload();await f.drain();assert.equal(f.platform.behavior,undefined);assert.equal(f.reads,before);
  f.setCurrent(snapshot(4,'reload-boot'));f.reload();await f.drain();
  assert.equal(f.reads,before+1);assert.equal(f.platform.behavior.behavior.bootId,'reload-boot');
});

for(const lifecycle of [false,true])test('close and a new ensure keep the replacement read token and promise when the obsolete read finally resolves (lifecycle='+lifecycle+')',async t=>{
  const f=await fixture(t,{lifecycle}),oldEntered=deferred(),oldRelease=deferred(),newEntered=deferred(),newRelease=deferred();
  f.setHook(id=>{if(id==='a'){oldEntered.resolve();return oldRelease.promise;}newEntered.resolve();return newRelease.promise;});
  const oldRefresh=f.platform.refreshBehavior();await oldEntered.promise;
  f.rebind('b');await newEntered.promise;const replacement=f.platform.refreshing,reading=f.platform.behaviorRead;
  f.changed(90,'obsolete-boot','transition','a');oldRelease.resolve(snapshot(90,'obsolete-boot'));await oldRefresh;
  assert.equal(f.platform.refreshing,replacement);assert.equal(f.platform.behaviorRead,reading);assert.equal(f.platform.behavior,undefined);
  newRelease.resolve(snapshot(2,'new-boot'));await f.drain();
  assert.equal(f.platform.behavior.behavior.bootId,'new-boot');assert.equal(f.platform.refreshing,undefined);assert.equal(f.platform.behaviorRead,undefined);
});

test('close during an in-flight read removes the actual listener and rejects its late projection',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();
  f.setHook(()=>{entered.resolve();return release.promise;});
  const refreshing=f.platform.refreshBehavior();await entered.promise;const reads=f.reads;
  f.platform.close();f.changed(9);release.resolve(snapshot(9));await refreshing;await f.drain();
  assert.equal(f.reads,reads);assert.equal(f.platform.behavior,undefined);assert.equal(f.platform.behaviorRead,undefined);
  assert.equal(f.ctx.get('petBehavior'),f.service,'Presentation closure cannot replace the shared Body service');
});

test('actual direct Body: a queued owner feed published after the observation read exits is included in the original refresh await',async t=>{
  const f=await fixture(t,{real:true,direct:true});
  await f.body.act(f.target.id,'water','tail-water','desktop');await f.drain();
  assert.equal(f.platform.behavior.her.kind,'drink');
  let action,injected=false;const transitions=[];
  const stop=f.ctx.on('pet/behavior.changed',event=>{
    if(!injected && event.reason==='observation') {injected=true;action=f.body.act(f.target.id,'feed','tail-feed','desktop');}
    if(event.reason==='transition')transitions.push({reading:Boolean(f.platform.behaviorRead),refreshing:Boolean(f.platform.refreshing)});
  });
  t.after(stop);f.body.binding.room.state.needs.thirst+=.02;t.mock.timers.setTime(Date.now()+10);
  await f.platform.refreshBehavior();assert.equal(injected,true);await action;
  assert.ok(transitions.some(event=>!event.reading && event.refreshing),'The real Body transition reached the settling gap');
  assert.equal(f.body.binding.room.state.kind,'eat');assert.equal(f.platform.behavior.her.kind,'eat');
  assert.equal(f.platform.behavior.behavior.revision,f.body.revision);
  assert.equal(f.platform.refreshAgain,false);assert.equal(f.platform.refreshing,undefined);
});

for(const trigger of ['transition','explicit'])test('actual refresh tail: a late '+trigger+' hands its pending read into the original await chain',async t=>{
  const f=await fixture(t),before=f.reads;
  const refreshing=f.platform.refreshBehavior();
  await atReadTail(f.platform,()=>{
    f.setCurrent(snapshot(2));
    if(trigger==='transition')f.changed(2,'fixture-boot','transition');
    else void f.platform.refreshBehavior();
    assert.equal(f.platform.refreshAgain,true);
  });
  await refreshing;
  assert.equal(f.reads,before+2);assert.equal(f.platform.behavior.behavior.revision,2);
  assert.equal(f.platform.refreshAgain,false);assert.equal(f.platform.refreshing,undefined);
});

for(const rebind of [false,true])test('actual refresh tail: '+(rebind?'a replacement ensure':'close')+' cannot be revived by obsolete final cleanup',async t=>{
  const f=await fixture(t,{lifecycle:true}),before=f.reads;
  const refreshing=f.platform.refreshBehavior();let replacement;
  await atReadTail(f.platform,()=>{
    f.changed(2,'fixture-boot','transition');
    if(rebind){f.setCurrent(snapshot(2,'replacement-boot'));f.rebind('b');replacement=f.platform.refreshing;}
    else f.platform.close();
  });
  await refreshing;await replacement;await f.drain();
  assert.equal(f.reads,before+(rebind?2:1));
  assert.equal(f.platform.behavior?.behavior.bootId,rebind?'replacement-boot':undefined);
  assert.equal(f.platform.refreshAgain,false);assert.equal(f.platform.refreshing,undefined);
});

test('Room, garden and actual Desktop settle together after reads and an owner action',async t=>{
  const f=await fixture(t,{real:true,direct:true});
  const readers=roomReaders(async()=>{t.mock.timers.setTime(Date.now()+1);return f.body.roomState(f.target.id);},async()=>{t.mock.timers.setTime(Date.now()+1);return f.body.garden(f.target.id,'state');});
  const stop=f.ctx.on('pet/behavior.changed',event=>readers.changed(event));t.after(stop);
  await readers.start();await readers.drain();await f.drain();
  assert.ok(readers.counts.main<=2&&readers.counts.garden<=2);
  await f.body.act(f.target.id,'water','shared-water','desktop');await readers.drain();await f.drain();
  assert.equal(f.platform.behavior.her.kind,'drink');assert.ok(readers.counts.main<=4&&readers.counts.garden<=4);
});
