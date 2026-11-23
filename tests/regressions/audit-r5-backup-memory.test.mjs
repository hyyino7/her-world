import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createCore} from '../../dist/src/core/index.js';
import {backupPlan,createOfflineBackup,restoreOfflineBackup} from '../../scripts/lib/offline-backup.mjs';

const value=result=>{assert.equal(result.ok,true,result.error?.message);return result.value;};
const write=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
const noWriter={probe(){}};
async function fixture(t,{configured='outside',owner='match',memory=true}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'backup-memory-code-'))),repo=join(root,'repo'),managed=join(repo,'.chatpet'),home=join(root,'dsh'),profile=join(home,'profiles/desktop');mkdirSync(repo);
  const config={dataDir:join(managed,'data/core'),companionId:'fixture',scopeId:'scope',ownerActorId:'owner',displayName:'Fixture',character:''};
  const host=createCore(config);let closed=false;host.workspace.runtime.store.setMeta('workspace.storage-id','stable-storage');
  let sequence=0;const request=()=>host.operator.request('backup-'+ ++sequence);
  const prefs=value(await host.services.preferences.read(request(),{}));
  const bound=value(await host.services.preferences.save(request(),{expectedRevision:prefs.revision,workspace:{id:'a',path:repo,title:'Fixture'},conversation:prefs.conversation}));
  value(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:bound.revision}));
  if(owner)host.workspace.runtime.store.setMeta('memory-configured-directory-owner',{id:owner==='match'?'stable-storage':'other-storage',path:owner==='match'?repo:join(root,'other-repo')});
  t.after(async()=>{if(!closed)await host.close();rmSync(root,{recursive:true,force:true});});
  await host.close();closed=true;
  const fallback=join(managed,'data/memory'),obsolete=configured==='outside'?join(root,'obsolete-bank'):configured==='custom'?join(repo,'custom-bank'):fallback;
  const bank=directory=>{mkdirSync(join(directory,'data'),{recursive:true});const file=join(directory,'data/memory.db'),db=new DatabaseSync(file);db.exec('CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES (\'retained Bank\');');db.close();};
  bank(fallback);if(obsolete!==fallback)bank(obsolete);
  if(memory)config.memory={python:join(root,'unused-python'),dataDir:obsolete};
  write(join(profile,'node_modules/her-world/package.json'),'{"name":"her-world","version":"fixture"}');
  const registry=join(home,'storages/workspace.json');write(registry,JSON.stringify({unit:{name:'workspace',version:1},global:{workspaceIds:['a'],archivedSessionIds:[],pinnedSessionIds:[],defaultWorkspaceId:'a'},tables:{workspaces:{a:{path:repo,title:'Fixture',sessionIds:[]}}}}));
  const input={repo,workspaceId:'a',storageId:'stable-storage',profileDir:profile,dshHome:home,config};
  const plan=backupPlan(input);
  const ownerFile=directory=>join(directory,'runtime/service.json');
  const live=directory=>write(ownerFile(directory),JSON.stringify({instance_id:'fixture',host:'127.0.0.1',port:12345,api_prefix:'/api/v1',api_version:'v1',pid:process.pid,token_env:'DSH_MEMORY_TOKEN'}));
  const stop=directory=>rmSync(ownerFile(directory),{force:true});
  return {root,repo,managed,home,profile,config,input,plan,fallback,obsolete,bank,live,stop,ownerFile};
}

for(const options of [{configured:'outside',owner:'match'},{configured:'custom',owner:'foreign'}])test(`R5: ${options.configured} stale config checks the actual fallback writer before create and restore`,async t=>{
  const f=await fixture(t,options);assert.equal(f.plan.memoryDirectory,f.fallback);
  assert.equal(f.plan.roots.some(root=>root.id==='memory'&&root.path===f.obsolete),false);
  f.live(f.fallback);const backup=join(f.root,'blocked-backup');
  assert.throws(()=>createOfflineBackup(f.plan,backup,noWriter),/memory.*live writer/i);assert.equal(existsSync(backup),false);
  f.stop(f.fallback);createOfflineBackup(f.plan,backup,noWriter);
  const current=readFileSync(join(f.fallback,'data/memory.db'));f.live(f.fallback);
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'blocked-safety'),noWriter),/memory.*live writer/i);
  assert.equal(existsSync(join(f.root,'blocked-safety')),false);assert.deepEqual(readFileSync(join(f.fallback,'data/memory.db')),current);
});

test('R5: a matching custom in-Repo Bank is the only Memory replacement root and writer gate',async t=>{
  const f=await fixture(t,{configured:'custom',owner:'match'});assert.equal(f.plan.memoryDirectory,f.obsolete);
  assert.equal(f.plan.roots.find(root=>root.id==='memory').path,f.obsolete);
  f.live(f.obsolete);assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'backup'),noWriter),/memory.*live writer/i);
  f.stop(f.obsolete);createOfflineBackup(f.plan,join(f.root,'backup'),noWriter);
});

test('R5: an unrelated old external Bank and its live owner are not copied, blocked or rewound',async t=>{
  const f=await fixture(t);f.live(f.obsolete);const backup=join(f.root,'backup');
  createOfflineBackup(f.plan,backup,noWriter);
  const unrelated=Buffer.from('future unrelated Bank');writeFileSync(join(f.obsolete,'data/memory.db'),unrelated);
  write(join(f.managed,'SOUL.md'),'current role');
  restoreOfflineBackup(f.plan,backup,join(f.root,'safety'),noWriter);
  assert.deepEqual(readFileSync(join(f.obsolete,'data/memory.db')),unrelated);assert.ok(existsSync(f.ownerFile(f.obsolete)));
  assert.notEqual(readFileSync(join(f.managed,'SOUL.md'),'utf8'),'current role');
});

for(const place of ['default','custom'])test(`R5: disabled Memory still refuses replacing a retained ${place} Bank with a live owner`,async t=>{
  const f=await fixture(t,{memory:false});const directory=place==='default'?f.fallback:join(f.managed,'data/retained-memory');
  if(place==='custom')f.bank(directory);const before=readFileSync(join(directory,'data/memory.db'));
  f.live(directory);assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'backup'),noWriter),/memory.*live writer/i);
  f.stop(directory);const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  f.live(directory);assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'blocked'),noWriter),/memory.*live writer/i);
  f.stop(directory);restoreOfflineBackup(f.plan,backup,join(f.root,'safety'),noWriter);assert.deepEqual(readFileSync(join(directory,'data/memory.db')),before);
});

test('R5: a Mnemosyne-marked retained owner is checked even if its disabled Bank file is missing',async t=>{
  const f=await fixture(t,{memory:false}),directory=join(f.managed,'data/partial-memory');f.live(directory);
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'backup'),noWriter),/memory.*live writer/i);
});

test('R5: generic same-named custom files are data, while a malformed real Memory owner fails closed',async t=>{
  const f=await fixture(t,{memory:false});
  write(join(f.managed,'data/pet-platform/pet/custom/runtime/service.json'),'not a Memory owner');
  const unrelated=join(f.managed,'data/pet-platform/pet/another/runtime/service.json');write(unrelated,JSON.stringify({pid:process.pid,description:'generic fixture data'}));
  write(join(f.managed,'data/pet-platform/pet/null/runtime/service.json'),'null');
  mkdirSync(join(f.managed,'data/pet-platform/pet/folder/runtime/service.json'),{recursive:true});
  createOfflineBackup(f.plan,join(f.root,'valid'),noWriter);
  write(f.ownerFile(f.fallback),'{"pid":"invalid","token_env":"DSH_MEMORY_TOKEN"}');
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'invalid'),noWriter),/Invalid memory owner/);
});

test('R5: backup refuses a missing declared Bank or its unreadable owner without repairing either',async t=>{
  const f=await fixture(t,{memory:false}),directory=join(f.managed,'data/declared-memory'),file=join(f.managed,'manifest.json');
  const manifest=JSON.parse(readFileSync(file,'utf8'));manifest.files.push('data/declared-memory/data/memory.db');writeFileSync(file,JSON.stringify(manifest));
  write(f.ownerFile(directory),'malformed former Memory owner');
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'missing'),noWriter),/Declared companion structure is incomplete/);
  assert.equal(existsSync(join(directory,'data/memory.db')),false);
  f.bank(directory);
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'invalid'),noWriter),/JSON/);
  assert.equal(readFileSync(f.ownerFile(directory),'utf8'),'malformed former Memory owner');
});

test('R5: the second create and final restore barriers check a newly live fallback owner before publishing or replacing',async t=>{
  const f=await fixture(t),blocked=join(f.root,'blocked');let calls=0;
  assert.throws(()=>createOfflineBackup(f.plan,blocked,{probe(){if(++calls===2)f.live(f.fallback);}}),/memory.*live writer/i);assert.equal(existsSync(blocked),false);
  f.stop(f.fallback);const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  write(join(f.managed,'SOUL.md'),'current role');calls=0;
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'safety'),{probe(){if(++calls===4)f.live(f.fallback);}}),/memory.*live writer/i);
  assert.equal(readFileSync(join(f.managed,'SOUL.md'),'utf8'),'current role');
});

test('R5: changing Core Memory ownership after planning invalidates the frozen actual Bank selection',async t=>{
  const f=await fixture(t,{configured:'custom',owner:'match'}),db=new DatabaseSync(join(f.config.dataDir,'core.sqlite'));
  try {db.prepare("UPDATE meta SET value=? WHERE key='memory-configured-directory-owner'").run(JSON.stringify({id:'other-storage',path:join(f.root,'other-repo')}));}finally{db.close();}
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'backup'),noWriter),/Memory.*changed|binding.*changed/i);
});

test('R5: missing actual Bank or corrupt ownership metadata is not a reason to copy the stale receipt Bank',async t=>{
  const f=await fixture(t);rmSync(join(f.fallback,'data/memory.db'));
  assert.throws(()=>backupPlan(f.input),/Memory Bank.*absent|Memory.*invalid/i);
  const g=await fixture(t),db=new DatabaseSync(join(g.config.dataDir,'core.sqlite'));
  try {db.prepare("UPDATE meta SET value=? WHERE key='memory-configured-directory-owner'").run('not JSON');}finally{db.close();}
  assert.throws(()=>backupPlan(g.input),/JSON/);
});
