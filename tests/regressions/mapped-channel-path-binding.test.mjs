import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,existsSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';

// Account adapters remain disabled. Even an accidental app/network path must
// fail before reaching the device; Core and channel implementations stay real.
const forbidden=[],restores=[];
function block(object,key) {
  const previous=object[key];restores.push(()=>{object[key]=previous;});
  object[key]=()=>{forbidden.push(key);throw Error('Forbidden channel-test app/network operation: '+key);};
}
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])block(childProcess,key);
for(const [object,keys] of [[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
  [net.Server.prototype,['listen']],[http,['request','get']],[https,['request','get']],
  [tls,['connect']],[globalThis,['fetch']]])for(const key of keys)block(object,key);
syncBuiltinESMExports();
after(()=>{for(const restore of restores.reverse())restore();syncBuiltinESMExports();assert.deepEqual(forbidden,[]);});

const {createCore}=await import(compiledURL('core/index.js'));
const {CompanionChannels}=await import(compiledURL('channels/plugin.js'));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const value=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};

async function fixture(t,{search}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'mapped-channel-path-')));
  const paths=Object.fromEntries(['a','b','c'].map(id=>[id,join(root,id)]));
  for(const path of Object.values(paths))mkdirSync(path);
  const profile=join(root,'profile');mkdirSync(profile);
  const host=createCore({dataDir:join(root,'core'),companionId:'fixture-fish',scopeId:'fixture-scope',
    ownerActorId:'owner',displayName:'Fixture',character:''});
  let sequence=0,onRemove,onRegister;
  const request=()=>host.operator.request('path-binding-'+sequence++);
  async function prepare(which) {
    const before=value(await host.services.preferences.read(request(),{}));
    const save=()=>host.services.preferences.save(request(),{expectedRevision:before.revision,conversation:before.conversation,
      workspace:{id:'same-native-workspace',path:paths[which],title:'Fixture'}});
    save.revision=before.revision+1;return save;
  }
  async function bind(which) {
    const save=await prepare(which),saved=value(await save());
    value(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:saved.revision}));
    assert.equal(host.workspace.status().state,'ready');
    assert.equal(host.workspace.status().target.path,paths[which]);
    assert.equal(host.workspace.storageId(),'same-native-workspace');
  }
  await bind('a');
  const listeners=new Map();
  const logger=Object.assign(()=>logger,{warn(){},error(){},info(){}});
  const ctx={logger,get(name){
    if(name==='workspaceRegistry')return {archivedSessionIds:[]};
    if(name==='petLife')return {homeSessionId:()=> 'fixture-owner-home',isHome:()=>true};
    if(name==='web'&&search)return {search};
  },on(name,listener){
    const list=listeners.get(name)??new Set();listeners.set(name,list);list.add(listener);
    onRegister?.(name);
    return ()=>{list.delete(listener);onRemove?.(name);};
  }};
  const channels=new CompanionChannels(ctx,host,{webServer:{getOrigin:()=> 'http://fixture.invalid'},
    sessionController:{resolveAgent(){throw Error('Native sessions/models are prohibited in this fixture');}}},profile);
  t.after(async()=>{onRemove=onRegister=undefined;await channels.close();await host.close();rmSync(root,{recursive:true,force:true});});
  const policy=which=>join(paths[which],'.chatpet/data/channels/preferences.json');
  const status=()=>channels.request('same-native-workspace','channelStatus',{});
  const configure=async next=>channels.request('same-native-workspace','messagingSettings',{expected:(await status()).messaging.config,next});
  return {host,channels,paths,bind,prepare,policy,status,configure,listeners,
    initialize:revision=>host.services.workspace.initialize(request(),{expectedPreferencesRevision:revision}),
    bytes:which=>readFileSync(policy(which),'utf8'),
    copy(from,to){cpSync(join(paths[from],'.chatpet'),join(paths[to],'.chatpet'),{recursive:true});},
    onRemove(fn){onRemove=fn;},onRegister(fn){onRegister=fn;}};
}

test('real Core same-ID copied-workspace rebind saves channel policy only in the new root',async t=>{
  const f=await fixture(t),first=await f.channels.refresh();
  const unchanged=await f.channels.refresh();assert.equal(unchanged,first,'Unchanged binding reuses its original adapters');
  const beforeA=f.bytes('a');f.copy('a','b');const beforeB=f.bytes('b');
  await f.bind('b');const second=await f.channels.refresh();
  assert.notEqual(second,first);assert.equal(second.path,f.paths.b);
  const saved=await f.configure({qq:{autoReply:false}});
  assert.equal(saved.messaging.config.qq.enabled,false);assert.equal(saved.messaging.config.wechat.enabled,false);
  assert.equal(f.bytes('a'),beforeA);assert.notEqual(f.bytes('b'),beforeB);
  assert.equal(JSON.parse(f.bytes('b')).qq.autoReply,false);
});

test('a retained real messaging callback cannot write its old root after a same-ID path move',async t=>{
  const f=await fixture(t),old=await f.channels.refresh(),before=f.bytes('a');
  f.copy('a','b');await f.bind('b');
  await assert.rejects(old.messaging.configure({qq:{autoReply:false}}),/workspace changed/);
  assert.equal(f.bytes('a'),before);assert.equal(f.bytes('b'),before);
  const current=await f.channels.refresh();assert.notEqual(current,old);
  await assert.rejects(old.messaging.configure({qq:{autoReply:false}}),/workspace changed/);
});

test('public local bridge and reach readers reject an old root before reconciliation',async t=>{
  const f=await fixture(t);await f.channels.refresh();
  const before=await f.status();
  await f.channels.request('same-native-workspace','bridgeSettings',{
    expected:before.bridge.preferences,next:{enabled:true,outlets:[]}});
  assert.ok(f.channels.local,'Actual local bridge starts without network outlets or account adapters');
  f.copy('a','b');await f.bind('b');
  assert.equal(f.channels.local,undefined);assert.equal(f.channels.qqConnection(),'off');
  assert.deepEqual(await f.channels.reach('same-native-workspace',{kind:'reach',name:'Fixture',text:'Read-only stale binding check',deliveryId:'stale-path'}),[]);
  await f.channels.refresh();assert.ok(f.channels.local);
});

test('late real group research cannot return sources from the old root after a path move',async t=>{
  const entered=deferred(),result=deferred();
  const f=await fixture(t,{search:()=>{entered.resolve();return result.promise;}});
  await f.channels.refresh();await f.configure({qq:{accountId:'12345',allowGroups:['6789']}});
  await f.channels.request('same-native-workspace','groupSlang',{
    groupId:'6789',content:'fixtureword',status:'candidate',meaning:'',usage:''});
  const waiting=f.channels.request('same-native-workspace','groupResearch',{groupId:'6789',content:'fixtureword'});
  const checked=assert.rejects(waiting,error=>error.code==='STALE_BINDING');
  await entered.promise;f.copy('a','b');await f.bind('b');
  result.resolve({sources:[{url:'https://fixture.invalid/reference',title:'External host seam'}]});
  await checked;await f.channels.refresh();assert.equal(f.channels.bound.path,f.paths.b);
});

test('a real settings commit cannot acknowledge the replacement root during adapter restart',async t=>{
  const f=await fixture(t);await f.channels.refresh();
  const expected=(await f.status()).messaging.config;
  f.copy('a','b');const beforeB=f.bytes('b'),saveB=await f.prepare('b');
  const rename=fs.renameSync;let saved,initialized;
  // The filesystem is the external commit seam. Do not replace configure or
  // its real adapter restart; move Core after the admitted A write commits.
  fs.renameSync=(from,to)=>{
    const result=rename(from,to);
    if(to===f.policy('a')&&!saved){saved=saveB();initialized=f.initialize(saveB.revision);}
    return result;
  };
  syncBuiltinESMExports();t.after(()=>{fs.renameSync=rename;syncBuiltinESMExports();});
  await assert.rejects(f.channels.request('same-native-workspace','messagingSettings',{
    expected,next:{qq:{autoReply:false}}}),error=>error.code==='STALE_BINDING');
  assert.ok(saved);value(await saved);value(await initialized);
  assert.equal(f.host.workspace.status().target.path,f.paths.b);
  assert.equal(JSON.parse(f.bytes('a')).qq.autoReply,false,'The A write was accepted before the path moved');
  assert.equal(f.bytes('b'),beforeB,'No A result is written or acknowledged as B policy');
  assert.equal((await f.channels.refresh()).path,f.paths.b);
});

test('reconciliation recaptures the root after real messaging cleanup changes Core preferences',async t=>{
  const f=await fixture(t);await f.channels.refresh();await f.bind('b');
  assert.equal(existsSync(f.policy('b')),false);
  const saveC=await f.prepare('c');let saved;
  f.onRemove(()=>{if(!saved)saved=saveC();});
  const next=await f.channels.refresh();f.onRemove(undefined);
  assert.ok(saved,'Actual adapter cleanup reached the external host disposer');value(await saved);
  assert.equal(next,undefined);assert.equal(existsSync(f.policy('b')),false,'An obsolete pre-cleanup path is not reopened');
  await f.bind('c');assert.equal((await f.channels.refresh()).path,f.paths.c);
});

test('path movement while real messaging is being created never publishes the obsolete binding',async t=>{
  const f=await fixture(t),saveB=await f.prepare('b');let saved;
  f.onRegister(()=>{if(!saved)saved=saveB();});
  assert.equal(await f.channels.refresh(),undefined);f.onRegister(undefined);
  value(await saved);assert.equal(f.channels.bound,undefined);
  await f.bind('b');assert.equal((await f.channels.refresh()).path,f.paths.b);
});

test('close fences retained callbacks and releases actual channel listeners without reopening',async t=>{
  const f=await fixture(t),old=await f.channels.refresh(),before=f.bytes('a');
  assert.ok([...f.listeners.values()].some(list=>list.size>0));
  await f.channels.close();assert.equal(f.channels.bound,undefined);
  assert.ok([...f.listeners.values()].every(list=>list.size===0));
  assert.equal(await f.channels.refresh(),undefined);assert.equal(f.channels.local,undefined);
  assert.equal(f.channels.qqConnection(),'off');
  await assert.rejects(old.messaging.configure({qq:{autoReply:false}}),/workspace changed/);
  assert.equal(f.bytes('a'),before);
});
