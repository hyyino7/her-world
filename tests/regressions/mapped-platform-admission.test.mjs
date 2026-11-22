import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';

const {CompanionRoom}=await import(compiledURL('living/body/room.js'));
const {PetPlatform}=await import(compiledURL('desktop/platform/plugin.js'));
const {DesktopFeatures}=await import(compiledURL('desktop/features.js'));
const {DEFAULT_COMPANION_SETTINGS}=await import(compiledURL('core/companion-settings.js'));
const upstream=createRequire(import.meta.url)(resolve('vendor/dsh-pet/platform/runtime.mjs'));

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'platform-admission-'));mkdirSync(join(dir,'pet'));
  t.mock.timers.enable({apis:['Date'],now:100000});
  const room=new CompanionRoom(dir,()=>undefined);
  Object.assign(room.state,{room:'living',spot:'sofa',route:null,dwell:null,command:null,freeTarget:null,
    asleep:false,sleepPending:false,kind:'idle',activity:'Quiet rest',lastTickAt:100000,
    needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0}});
  const calls=[],frames=[],writes=[],binding={id:'fixture',path:dir,storageId:'fixture'};
  const behavior={restState:()=>({sleeping:room.state.asleep,pending:room.state.sleepPending}),
    roomAction:async(id,input,by,interaction)=>{calls.push({id,input,by,interaction});return room.act(input,by,Date.now(),interaction);}};
  const host={workspace:{status:()=>({state:'ready',target:binding}),storageId:()=>binding.storageId,companionSettings:()=>DEFAULT_COMPANION_SETTINGS,
    runtime:{config:{ownerActorId:'trusted-owner',companionId:'fixture-fish'},identity:()=>({displayName:'Fixture'})}}};
  const ctx={petCore:host,petDesktop:{},get:name=>name==='petBehavior'?behavior:undefined,logger:()=>({warn(){},info(){}})};
  const features=new DesktopFeatures(ctx,host,(type,value)=>frames.push({type,value}),()=>false,()=>false);ctx.petDesktop.features=features;
  const platform=new PetPlatform(ctx);platform.ensure=()=>{};platform.bound=binding;
  const configPaths={defaultFile:resolve('vendor/dsh-pet/platform/assets/config.jsonc'),userFile:join(dir,'main.json'),legacyUserFile:join(dir,'old.json'),petDir:join(dir,'pet')};
  const state={cancelAll(){},writeSection(){},writePet:(id,key,value)=>writes.push({id,key,value})};
  platform.setup={configPaths,state,playback:{cancelAll(){}}};
  platform.lookup=upstream.createPetLookup({configPaths,state});
  t.after(async()=>{platform.close();await features.close();room.flush();rmSync(dir,{recursive:true,force:true});});
  const handle=(path,raw)=>platform.handle(new URL('http://fixture/chatpet-presentation/'+path),'POST',JSON.stringify(raw),new AbortController().signal);
  const direct=(action,params={},requestId='actual-'+action)=>handle(action+'?'+new URLSearchParams(params),{requestId});
  const native=(action,params={},requestId='actual-'+action,outer={})=>handle('native-feature?'+new URLSearchParams(outer),
    {path:'/'+action+'?'+new URLSearchParams(params),method:'POST',body:JSON.stringify({requestId}),actor:{kind:'system',id:'untrusted-input'}});
  const lease=()=>{const result=platform.lookup.lock.acquire({petId:'main',ttl:30000});assert.equal(result.ok,true);return result.lockId;};
  return {room,platform,features,calls,frames,writes,direct,native,lease};
}
const result=reply=>{assert.equal(reply.kind,'json');assert.equal(reply.status,200);return reply.obj;};

for(const route of ['direct','native']) {
  test(route+': sleep retains the original unconditional held-lock rejection',async t=>{
    const f=fixture(t),lock=f.lease();
    assert.deepEqual(f.room.pendingFacts(),[]); // Normalize the real reader before taking the unchanged-state baseline.
    const before=JSON.stringify(f.room.state);
    for(const token of [undefined,lock,'wrong-token']) {
      const reply=result(await f[route]('sleep',token?{lock:token}:{}));
      assert.equal(reply.ok,false);assert.equal(reply.reason,'locked');assert.match(reply.message,/不能睡觉/);
    }
    assert.equal(f.calls.length,0);assert.equal(f.room.pendingFacts().length,0);assert.equal(f.frames.length,0);
    assert.equal(JSON.stringify(f.room.state),before,'Denied sleep cannot alter Body state');
  });
  test(route+': unlocked sleep accepts the default pet without surface and preserves exactly-once identity',async t=>{
    const f=fixture(t),old=f.lease();assert.equal(f.platform.lookup.lock.release({petId:'main',lockId:old}).ok,true);
    // The original sleep route ignores a stale token when no lease remains.
    for(let i=0;i<2;i++)assert.equal(result(await f[route]('sleep',{lock:old},'same-actual-sleep')).ok,true);
    assert.equal(f.calls.length,2);assert.equal(f.room.pendingFacts().length,1);
    for(const call of f.calls) {
      assert.equal(call.interaction.requestId,'same-actual-sleep');
      assert.deepEqual(call.interaction.actor,{kind:'owner',id:'trusted-owner',channel:'desktop'});
    }
  });
  test(route+': wake remains available while locked with matching, wrong or absent tokens',async t=>{
    const f=fixture(t),lock=f.lease();Object.assign(f.room.state,{asleep:true,kind:'sleep',activity:'Sleeping'});
    for(const [index,token] of [undefined,lock,'lost-token'].entries()) {
      assert.equal(result(await f[route]('wake',token?{lock:token}:{},'actual-wake-'+index)).ok,true);
      assert.equal(f.platform.lookup.lock.locked('main'),true,'Wake is allowed without stealing the existing lease');
    }
    assert.equal(f.calls.length,3);assert.equal(f.room.state.asleep,false);
  });
  test(route+': unknown pets are rejected before any Body care',async t=>{
    const f=fixture(t);
    for(const action of ['sleep','wake',...(route==='native'?['pet']:[])]) {
      const reply=result(await f[route](action,{pet:'missing'}));assert.equal(reply.ok,false);assert.equal(reply.reason,'unknown-pet');
    }
    assert.equal(f.calls.length,0);assert.equal(f.room.pendingFacts().length,0);
  });
}
test('native pet uses the actual ordinary lock gate, preserving matching tokens and lost-token causes',async t=>{
  const f=fixture(t),lock=f.lease();
  assert.equal(result(await f.native('pet')).reason,'lock-required');
  const wrong=result(await f.native('pet',{lock:'wrong'}));assert.equal(wrong.reason,'lock-lost');assert.equal(wrong.cause,'unknown');
  assert.equal(f.calls.length,0);assert.equal(f.room.pendingFacts().length,0);
  for(let i=0;i<2;i++)assert.equal(result(await f.native('pet',{lock},'same-actual-touch')).ok,true);
  assert.equal(f.room.pendingFacts().length,1);assert.equal(f.room.state.counts.pet,1);
  f.platform.lookup.lock.release({petId:'main',lockId:lock});
  const lost=result(await f.native('pet',{lock}));assert.equal(lost.reason,'lock-lost');assert.equal(lost.cause,'released');
  assert.equal(f.room.pendingFacts().length,1);assert.equal(result(await f.native('pet',{},'next-actual-touch')).ok,true);
  assert.equal(f.room.state.counts.pet,2);
});
test('native care honors outer compatibility parameters while an explicit inner token cannot bypass its gate',async t=>{
  const f=fixture(t),lock=f.lease();
  assert.equal(result(await f.native('pet',{},'outer-token',{pet:'main',lock})).ok,true);
  assert.equal(result(await f.native('pet',{lock:'wrong'},'inner-token',{pet:'main',lock})).reason,'lock-lost');
  assert.equal(result(await f.native('pet',{},'unknown-outer',{pet:'missing',lock})).reason,'unknown-pet');
  assert.equal(f.room.state.counts.pet,1);
});
test('native whisper and balance retain their existing eligibility without new pet/surface rules',async t=>{
  const f=fixture(t),observed=[];f.lease();
  f.features.whisper=async()=>{observed.push('whisper');return {ok:true};};
  f.features.balance=async()=>{observed.push('balance');return {ok:true};};
  for(const action of ['whisper','balance'])assert.equal(result(await f.native(action,{pet:'missing'})).ok,true);
  assert.deepEqual(observed,['whisper','balance']);assert.equal(f.calls.length,0);assert.equal(f.room.pendingFacts().length,0);
});
test('actual native Z and sleep menu keep using the protected sleep endpoint without requiring surface',async()=>{
  const requests=[];
  const scope={console,BASE:'/presentation',S:{postAction:async(...args)=>{requests.push(args);return true;},
    displayOfHotkey:()=>null,isChatHotkey:()=>false,isCaptureHotkey:()=>false,isTodoHotkey:()=>false,isSleepHotkey:()=>true},window:{}};
  const files=['sprite/input.js','sprite/menu.js','sprite/playback.js'].map(name=>readFileSync('vendor/dsh-pet/platform/runtime/electron-helper/'+name,'utf8'));
  runInNewContext('class PetSprite {}\n'+files.join('\n')+'\nglobalThis.sprite=new PetSprite();',scope);
  Object.assign(scope.sprite,{pet:{id:'main'},hoverBody:true,hearHold:{onKeyDown:()=>false},sleeping:false,animations:{sleep:[{}]},closeMenu(){}});
  scope.sprite.onHotkey({preventDefault(){}});scope.sprite.onMenuAction({action:'sleep'});await Promise.resolve();
  assert.equal(requests.length,2);for(const [url] of requests)assert.equal(url,'/presentation/sleep?pet=main');
});
