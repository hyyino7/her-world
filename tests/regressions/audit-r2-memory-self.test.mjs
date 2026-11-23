import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryConnection} from '../../dist/src/memory/client.js';
import {MemoryProcessHost} from '../../vendor/mnemosyne/src/memory-process.js';
import {MemoryClient} from '../../vendor/mnemosyne/src/memory-client.js';
import {createCore} from '../../dist/src/core/index.js';
import {settingsHandler} from '../../dist/src/console/settings.js';

const scope={companionId:'fixture-fish',scopeId:'fixture-owner',workspaceId:'fixture-bank'};
const memoryScope={companionId:scope.companionId,scopeId:scope.scopeId,bankId:scope.workspaceId};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function memoryFixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'r2-memory-code-')));
  const state={starts:0,stops:0,requests:[],hosts:[],live:new Set(),maxOwned:0,stopState:'stopped',startFailures:0,startGate:undefined,entered:undefined};
  t.mock.method(MemoryProcessHost.prototype,'start',async function(){
    state.starts++;state.hosts.push(this);state.entered?.resolve();await state.startGate?.promise;
    if(state.startFailures){state.startFailures--;throw Error('fixture startup failure');}
    this.child={pid:state.starts,exitCode:null,signalCode:null,killed:false};this.ready=true;
    this.baseUrl='http://never-requested.invalid/'+state.starts;
    state.live.add(this);state.maxOwned=Math.max(state.maxOwned,state.live.size);
    return this.info();
  });
  t.mock.method(MemoryProcessHost.prototype,'stop',async function(){
    state.stops++;this.ready=false;
    if(state.stopState==='unresolved')return {state:'unresolved',pid:this.child?.pid};
    state.live.delete(this);this.child=null;return {state:'stopped',pid:null};
  });
  t.mock.method(MemoryClient.prototype,'request',async function(method,path,body){
    const result={baseUrl:this.baseUrl,method,path,body};state.requests.push(result);return result;
  });
  const connection=new MemoryConnection({dataDir:join(root,'.chatpet/data/memory'),python:join(root,'never-spawned-python')});
  const start=(bank=memoryScope)=>connection.start(bank,root,true);
  function die(){const host=state.hosts.at(-1);host.ready=false;host.child.exitCode=1;host.child=null;state.live.delete(host);}
  t.after(async()=>{state.startGate?.resolve();state.stopState='stopped';await connection.close();rmSync(root,{recursive:true,force:true});});
  return {root,connection,state,start,die};
}

test('R2-1: the same Bank recovers after observed child exit through the original host and client',async t=>{
  const f=memoryFixture(t);await f.start();const initial=await f.connection.call('context',{});
  f.die();assert.equal(f.connection.lifecycle,'stopped');await f.start();
  assert.equal(f.state.starts,2);assert.equal(f.state.maxOwned,1);assert.equal(f.connection.lifecycle,'ready');
  const recovered=await f.connection.call('context',{},scope.workspaceId);
  assert.notEqual(recovered.baseUrl,initial.baseUrl);assert.deepEqual(recovered.body.scope,scope);
});

test('R2-1: a dead host never sends a request through its stale client before recovery',async t=>{
  const f=memoryFixture(t);await f.start();f.die();
  await assert.rejects(f.connection.call('observe',{source_id:'fixture'}),/unavailable/);assert.equal(f.state.requests.length,0);
});

test('R2-1: unresolved stop retains the owned host and blocks replacement until exit is confirmed',async t=>{
  const f=memoryFixture(t);await f.start();f.state.hosts[0].ready=false;f.state.stopState='unresolved';
  await assert.rejects(f.start(),/unresolved/);await assert.rejects(f.start(),/unresolved/);
  assert.equal(f.state.starts,1);assert.equal(f.connection.lifecycle,'unresolved');
  await assert.rejects(f.connection.call('context',{}),/unavailable/);
  f.state.stopState='stopped';await f.start();assert.equal(f.state.starts,2);assert.equal(f.state.maxOwned,1);
});

test('R2-1: successful same-scope preparation reuses one live host; failed startup remains retryable',async t=>{
  const f=memoryFixture(t);f.state.startFailures=1;await assert.rejects(f.start(),/startup failure/);
  await f.start();await Promise.all([f.start(),f.start()]);assert.equal(f.state.starts,2);assert.equal(f.state.maxOwned,1);
  await assert.rejects(f.connection.call('context',{},'other-bank'),error=>error.code==='STALE_BINDING');
});

test('R2-1: close queues behind recovery startup and leaves no newly owned child',async t=>{
  const f=memoryFixture(t);await f.start();f.die();f.state.startGate=deferred();f.state.entered=deferred();
  const recovering=f.start();for(let turn=0;turn<5;turn++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.state.starts,2,'Recovery reaches the existing owned-host start seam');
  await f.state.entered.promise;const closing=f.connection.close();f.state.startGate.resolve();
  await Promise.all([recovering,closing]);assert.equal(f.state.starts,2);assert.equal(f.connection.lifecycle,'stopped');assert.equal(f.state.live.size,0);
});

test('R2-1: unresolved close keeps ownership, permits a later close retry and never starts a second writer',async t=>{
  const f=memoryFixture(t);await f.start();f.state.stopState='unresolved';
  await assert.rejects(f.connection.close(),/unresolved/);assert.equal(f.connection.lifecycle,'unresolved');
  await assert.rejects(f.start(),/unresolved/);assert.equal(f.state.starts,1);
  f.state.stopState='stopped';await f.connection.close();assert.equal(f.connection.lifecycle,'stopped');
  await f.start();assert.equal(f.state.starts,2);assert.equal(f.state.maxOwned,1);
});

const value=result=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
async function selfFixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'r2-self-code-'))),repo=join(root,'a');mkdirSync(repo);
  const host=createCore({dataDir:join(repo,'.chatpet/data/core'),companionId:'fixture-fish',scopeId:'fixture-owner',ownerActorId:'fixture-owner',displayName:'Fixture',character:'Disposable companion'});
  let revision=0;
  async function bind(id,path){
    const prefs=value(await host.services.preferences.read(host.operator.request('prefs-'+ ++revision),{}));
    const saved=value(await host.services.preferences.save(host.operator.request('bind-'+revision),{expectedRevision:prefs.revision,workspace:{id,path,title:id},conversation:prefs.conversation}));
    value(await host.services.workspace.initialize(host.operator.request('initialize-'+revision),{expectedPreferencesRevision:saved.revision}));
  }
  await bind('a',repo);t.after(async()=>{await host.close();rmSync(root,{recursive:true,force:true});});
  return {root,repo,host,bind,file:join(repo,'.chatpet/self.md')};
}

test('R2-2: concurrent self saves sharing an actual old snapshot allow one commit and one stale rejection',async t=>{
  const f=await selfFixture(t);writeFileSync(f.file,'Original');const before=await f.host.records.readSelf('a');
  const original=f.host.records.readSelf.bind(f.host.records),gate=deferred();let reads=0;
  t.mock.method(f.host.records,'readSelf',async id=>{const result=await original(id);if(++reads===2)gate.resolve();await gate.promise;return result;});
  const results=await Promise.allSettled([f.host.records.saveSelf('a',before.revision,'First'),f.host.records.saveSelf('a',before.revision,'Second')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected.reason.code,'STALE_REVISION');
  const accepted=results.find(result=>result.status==='fulfilled');assert.equal(readFileSync(f.file,'utf8'),accepted.value.text);
});

test('R2-2: a self edit completed after the asynchronous snapshot cannot be overwritten by an old form',async t=>{
  const f=await selfFixture(t);writeFileSync(f.file,'Original');const before=await f.host.records.readSelf('a');
  const original=f.host.records.readSelf.bind(f.host.records),entered=deferred(),gate=deferred();
  t.mock.method(f.host.records,'readSelf',async id=>{const result=await original(id);entered.resolve();await gate.promise;return result;});
  const saving=f.host.records.saveSelf('a',before.revision,'Stale form');await entered.promise;writeFileSync(f.file,'Later file edit');gate.resolve();
  await assert.rejects(saving,error=>error.code==='STALE_REVISION');assert.equal(readFileSync(f.file,'utf8'),'Later file edit');
});

test('R2-2: changing workspaces during self reading cannot write either old or newly selected document',async t=>{
  const f=await selfFixture(t);writeFileSync(f.file,'Original A');const before=await f.host.records.readSelf('a');
  const original=f.host.records.readSelf.bind(f.host.records),entered=deferred(),gate=deferred();
  t.mock.method(f.host.records,'readSelf',async id=>{const result=await original(id);entered.resolve();await gate.promise;return result;});
  const saving=f.host.records.saveSelf('a',before.revision,'Stale A');await entered.promise;
  const b=join(f.root,'b');mkdirSync(b);await f.bind('b',b);writeFileSync(join(b,'.chatpet/self.md'),'Original B');gate.resolve();
  await assert.rejects(saving,error=>error.code==='STALE_BINDING');assert.equal(readFileSync(f.file,'utf8'),'Original A');assert.equal(readFileSync(join(b,'.chatpet/self.md'),'utf8'),'Original B');
});

test('R2-2: final comparison preserves stable UTF-8 BOM and empty-document revision behavior',async t=>{
  const f=await selfFixture(t);writeFileSync(f.file,'\ufeffOriginal');
  const bom=await f.host.records.readSelf('a');assert.equal(bom.text,'Original');await f.host.records.saveSelf('a',bom.revision,'Updated');
  const current=await f.host.records.readSelf('a');await f.host.records.saveSelf('a',current.revision,'');
  const empty=await f.host.records.readSelf('a');await f.host.records.saveSelf('a',empty.revision,'From empty');assert.equal(readFileSync(f.file,'utf8'),'From empty');
});

for (const interruption of ['ABA', 'cancel', 'unload']) {
  test('self write checks '+interruption+' after reading and before writing',async t=>{
    const f=await selfFixture(t),controller=new AbortController();
    writeFileSync(f.file,'Original A');
    const before=await f.host.records.readSelf('a');
    const original=f.host.records.readSelf.bind(f.host.records),entered=deferred(),gate=deferred();
    t.mock.method(f.host.records,'readSelf',async id=>{const result=await original(id);entered.resolve();await gate.promise;return result;});
    let host=f.host;
    const consoleCall=settingsHandler(()=>host,()=>undefined);
    const saving=consoleCall('self',{requestId:'self-interrupted',input:{workspaceId:'a',expectedRevision:before.revision,text:'Late write'}},
      controller.signal,{principal:{kind:'owner'},signal:new AbortController().signal});
    await entered.promise;
    if(interruption==='ABA'){
      const b=join(f.root,'b');mkdirSync(b);await f.bind('b',b);await f.bind('a',f.repo);
    }else if(interruption==='cancel')controller.abort();
    else host=undefined;
    gate.resolve();
    const reply=await saving;
    assert.equal(reply.ok,false);
    assert.equal(reply.error.code,interruption==='cancel'?'CANCELLED':'STALE_BINDING');
    assert.equal(reply.error.effect,'none');
    assert.equal(readFileSync(f.file,'utf8'),'Original A');
  });
}

test('cancelling initialization while waiting for Core persistence leaves the selected workspace uninitialized',async t=>{
  const f=await selfFixture(t),target=join(f.root,'uninitialized');mkdirSync(target);
  const request=name=>f.host.operator.request(name);
  const before=value(await f.host.services.preferences.read(request('initial-config'),{}));
  const configured=value(await f.host.services.preferences.save(request('new-target'),{
    expectedRevision:before.revision,workspace:{id:'new',path:target,title:'New'},conversation:before.conversation,
  }));
  const store=f.host.workspace.runtime.store, original=store.ensurePersisted.bind(store), entered=deferred(), gate=deferred();
  t.mock.method(store,'ensurePersisted',async()=>{await original();entered.resolve();await gate.promise;});
  const controller=new AbortController();
  const initializing=f.host.services.workspace.initialize(request('interrupted-initialization'),
    {expectedPreferencesRevision:configured.revision},{signal:controller.signal});
  await entered.promise;controller.abort();gate.resolve();
  const reply=await initializing;
  assert.equal(reply.ok,false);
  assert.equal(reply.error.code,'CANCELLED');
  assert.equal(reply.error.effect,'none');
  assert.deepEqual(readdirSync(target),[]);
});

for (const replaced of ['Core provider', 'workspace registration']) {
  test(`Console initialization writes nothing when its ${replaced} changes during persistence`, async t => {
    const f = await selfFixture(t), target = join(f.root, 'uninitialized');
    mkdirSync(target);
    const prefs = f.host.services.preferences, request = name => f.host.operator.request(name);
    const before = value(await prefs.read(request('initial-config'), {}));
    const configured = value(await prefs.save(request('new-target'), {
      expectedRevision: before.revision, workspace: {id:'new', path:target, title:'New'}, conversation: before.conversation,
    }));
    const store = f.host.workspace.runtime.store, original = store.ensurePersisted.bind(store);
    const entered = deferred(), gate = deferred();
    t.mock.method(store, 'ensurePersisted', async () => { await original(); entered.resolve(); await gate.promise; });
    let provider = f.host, workspace = {id:'new', path:target, status:async () => 'ok'};
    const consoleCall = settingsHandler(() => provider, () => ({get:id => id === 'new' ? workspace : undefined}));
    const pending = consoleCall('initialize', {requestId:'init-after-replacement', input:{expectedPreferencesRevision:configured.revision}},
      new AbortController().signal, {principal:{kind:'owner'}, signal:new AbortController().signal});
    await entered.promise;
    if (replaced === 'Core provider') provider = undefined;
    else workspace = {...workspace};
    gate.resolve();
    const reply = await pending;
    assert.deepEqual(readdirSync(target), []);
    assert.equal(reply.ok, false);
    assert.equal(reply.error.code, 'STALE_BINDING');
    assert.equal(reply.error.effect, 'none');
  });
}
