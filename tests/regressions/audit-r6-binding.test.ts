import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCore,type PetCoreHost} from '../../src/core/index.js';
import {settingsHandler} from '../../src/console/settings.js';
import type {Result} from '../../src/contracts/common.js';
const value=<T>(r:Result<T>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const id=randomUUID;
async function scope(host:PetCoreHost) {
  const prefs=value(await host.services.preferences.read(host.operator.request(id()),{}));
  return {preferencesRevision:prefs.revision,workspaceId:prefs.workspace?.id??null,storageId:prefs.workspace?host.workspace.storageId():null};
}
async function fixture(t:TestContext) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'r6-owner-scope-')));
  const config={dataDir:join(root,'core'),companionId:'fish',scopeId:'scope',ownerActorId:'owner',displayName:'',character:''};
  const targets=['A','B'].map(id=>({id,path:join(root,id),title:id,status:async()=> 'ok' as const}));
  for(const target of targets) {
    mkdirSync(target.path);
    const prepared=createCore({...config,dataDir:join(target.path,'.chatpet/data/core')});
    try {
      const prefs=value(await prepared.services.preferences.read(prepared.operator.request(id()),{}));
      const saved=value(await prepared.services.preferences.save(prepared.operator.request(id()),{expectedRevision:prefs.revision,workspace:{id:target.id,path:target.path,title:target.title},conversation:prefs.conversation}));
      value(await prepared.services.workspace.initialize(prepared.operator.request(id()),{expectedPreferencesRevision:saved.revision}));
    }finally{await prepared.close();}
  }
  const host=createCore(config);t.after(async()=>{await host.close();rmSync(root,{recursive:true,force:true});});
  async function bind(which:string|null) {
    const prefs=value(await host.services.preferences.read(host.operator.request(id()),{})),target=targets.find(target=>target.id===which);
    const saved=value(await host.services.preferences.save(host.operator.request(id()),{expectedRevision:prefs.revision,workspace:target?{id:target.id,path:target.path,title:target.title}:null,conversation:prefs.conversation}));
    if(which)value(await host.services.workspace.initialize(host.operator.request(id()),{expectedPreferencesRevision:saved.revision}));
  }
  const handler=settingsHandler(()=>host,()=>({list:()=>targets,get:id=>targets.find(target=>target.id===id)}));
  const signal=new AbortController().signal,peer={principal:{kind:'owner'},signal};
  return {host,config,targets,bind,handler,signal,peer,
    bytes:()=>targets.map(target=>['USER.md','SOUL.md'].map(name=>readFileSync(join(target.path,'.chatpet',name),'utf8'))),
    rpc:(endpoint:string,input:unknown)=>handler(endpoint,{requestId:id(),input},signal,peer)};
}
for(const operation of ['profile','identity'])test(`R6-01: stale ${operation} from A cannot write B when original content and revision match`,async t=>{
  const f=await fixture(t);await f.bind('A');
  const expectedScope=await scope(f.host),identity=f.host.workspace.runtime.identity();
  const profile=value(await f.host.services.workspace.readProfile(f.host.operator.request(id()),{}));
  await f.bind('B');const before=f.bytes();
  const result=operation==='profile'
    ?await f.host.services.workspace.saveProfile(f.host.operator.request(id()),{expectedScope,expectedRevision:profile.revision,text:'old A profile'})
    :await f.host.services.core.reviseIdentity(f.host.operator.request(id()),{expectedScope,expectedRevision:identity.revision,displayName:'Old A',character:'old A role'});
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'STALE_BINDING');assert.deepEqual(f.bytes(),before);
});
test('R6-01: A→B→A invalidates the original profile scope even though content stayed identical',async t=>{
  const f=await fixture(t);await f.bind('A');const expectedScope=await scope(f.host);
  const profile=value(await f.host.services.workspace.readProfile(f.host.operator.request(id()),{}));
  await f.bind('B');await f.bind('A');const before=f.bytes();
  const result=await f.host.services.workspace.saveProfile(f.host.operator.request(id()),{expectedScope,expectedRevision:profile.revision,text:'expired A'});
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'STALE_BINDING');assert.deepEqual(f.bytes(),before);
});
test('R6-01: explicit unbound identity edits remain supported and a missing scope is never inferred',async t=>{
  const f=await fixture(t),identity=f.host.workspace.runtime.identity();
  const missing=await f.host.services.core.reviseIdentity(f.host.operator.request(id()),{expectedRevision:identity.revision,displayName:'Missing',character:'Missing'} as never);
  assert.equal(missing.ok,false);assert.equal(f.host.workspace.runtime.identity().displayName,'');
  const expectedScope=await scope(f.host);assert.equal(expectedScope.workspaceId,null);assert.equal(expectedScope.storageId,null);
  const result=await f.host.services.core.reviseIdentity(f.host.operator.request(id()),{expectedScope,expectedRevision:identity.revision,displayName:'Local',character:'Before binding'});
  assert.equal(result.ok,true);assert.equal(f.host.workspace.runtime.identity().displayName,'Local');
});
test('R6-01: current bound scope accepts profile/identity, preserves CAS/replay and rejects storage replacement',async t=>{
  const f=await fixture(t);await f.bind('A');const expectedScope=await scope(f.host);
  const identity=f.host.workspace.runtime.identity(),request=f.host.operator.request(id());
  const input={expectedScope,expectedRevision:identity.revision,displayName:'A name',character:'A role'};
  const saved=value(await f.host.services.core.reviseIdentity(request,input));
  assert.deepEqual(value(await f.host.services.core.reviseIdentity(request,input)),saved);
  const conflict=await f.host.services.core.reviseIdentity(request,{...input,character:'Different'});assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.error.code,'CONFLICT');
  const profile=value(await f.host.services.workspace.readProfile(f.host.operator.request(id()),{}));
  value(await f.host.services.workspace.saveProfile(f.host.operator.request(id()),{expectedScope,expectedRevision:profile.revision,text:'A owner'}));
  const before=f.bytes();
  const invalid=await f.host.services.core.reviseIdentity(f.host.operator.request(id()),{...input,expectedRevision:saved.revision,expectedScope:{...expectedScope,storageId:'replacement'}});
  assert.equal(invalid.ok,false);if(!invalid.ok)assert.equal(invalid.error.code,'STALE_BINDING');assert.deepEqual(f.bytes(),before);
});
test('R6-01: RPC returns an explicit editor scope and forwards it to both save paths',async t=>{
  const f=await fixture(t);await f.bind('A');const snapshot=await f.rpc('snapshot',{});assert.equal(snapshot.ok,true);if(!snapshot.ok)return;
  const data=snapshot.value as {editorScope:unknown;profile:{revision:number};identity:{revision:number}};
  assert.deepEqual(data.editorScope,await scope(f.host));
  assert.equal((await f.rpc('profile',{expectedScope:data.editorScope,expectedRevision:data.profile.revision,text:'RPC owner'})).ok,true);
  assert.equal((await f.rpc('identity',{expectedScope:data.editorScope,expectedRevision:data.identity.revision,displayName:'RPC',character:'RPC role'})).ok,true);
  const before=f.bytes();await f.bind('B');
  const stale=await f.rpc('profile',{expectedScope:data.editorScope,expectedRevision:data.profile.revision+1,text:'Late A'});
  assert.equal(stale.ok,false);if(!stale.ok)assert.equal(stale.error.code,'STALE_BINDING');assert.equal(f.bytes()[1]![0],before[1]![0]);
});
test('R6-01: snapshot refuses a binding switch while registry availability awaits',async t=>{
  const f=await fixture(t);await f.bind('A');let release!:(value:'ok')=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const registry={list:()=>[{...f.targets[0]!,status:()=>{entered();return new Promise<'ok'>(resolve=>{release=resolve;});}}],get:(id:string)=>f.targets.find(target=>target.id===id)};
  const handler=settingsHandler(()=>f.host,()=>registry);
  const pending=handler('snapshot',{requestId:id(),input:{}},f.signal,f.peer);await waiting;await f.bind('B');release('ok');
  const result=await pending;assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'STALE_BINDING');
});
test('R6-01: profile requests without an explicit scope cannot borrow the current binding',async t=>{
  const f=await fixture(t);await f.bind('A');const before=f.bytes();
  const profile=value(await f.host.services.workspace.readProfile(f.host.operator.request(id()),{}));
  const result=await f.host.services.workspace.saveProfile(f.host.operator.request(id()),{expectedRevision:profile.revision,text:'missing scope'} as never);
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'INVALID_ARGUMENT');assert.deepEqual(f.bytes(),before);
});
test('R6-01: a local unbound identity draft is invalid once a workspace is selected',async t=>{
  const f=await fixture(t),expectedScope=await scope(f.host),identity=f.host.workspace.runtime.identity();
  await f.bind('A');const before=f.bytes();
  const result=await f.host.services.core.reviseIdentity(f.host.operator.request(id()),{expectedScope,expectedRevision:identity.revision,displayName:'old local',character:'old local'});
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'STALE_BINDING');assert.deepEqual(f.bytes(),before);
});
test('R6-01: actual storage identity replacement revokes a draft with the same workspace id/path',async t=>{
  const f=await fixture(t),host=createCore({...f.config,dataDir:join(f.targets[0]!.path,'.chatpet/data/core')});
  try {
    const expectedScope=await scope(host),profile=value(await host.services.workspace.readProfile(host.operator.request(id()),{})),before=f.bytes();
    host.workspace.runtime.store.setMeta('workspace.storage-id','changed-storage');
    const write=(editor:typeof expectedScope)=>host.services.workspace.saveProfile(host.operator.request(id()),
      {expectedScope:editor,expectedRevision:profile.revision,text:'old storage'});
    const stale=await write(expectedScope);
    assert.equal(stale.ok,false);if(!stale.ok)assert.equal(stale.error.code,'STALE_BINDING');
    const current=await write(await scope(host));
    assert.equal(current.ok,false);if(!current.ok)assert.equal(current.error.code,'migration-required');
    assert.deepEqual(f.bytes(),before);
  }finally{await host.close();}
});
