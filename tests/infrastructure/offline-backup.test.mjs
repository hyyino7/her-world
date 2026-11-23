import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { backupPlan, createOfflineBackup, restoreOfflineBackup, verifyOfflineBackup } from '../../scripts/lib/offline-backup.mjs';

const write = (path, text) => { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path,text); };
const read = path => readFileSync(path,'utf8');
const noWriter = { probe() {} };
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'fish-offline-backup-')));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'), home=join(root,'dsh'), profile=join(home,'profiles','desktop'), managed=join(repo,'.chatpet');
  const config={companionId:'fish',scopeId:'scope',ownerActorId:'human',dataDir:join(managed,'data','core'),memory:{dataDir:join(managed,'data','memory')}};
  write(join(managed,'manifest.json'),JSON.stringify({schemaVersion:3,companionId:'fish',files:['README.md','manifest.json','SOUL.md','USER.md','core.json','COMPANION.md','data/core/core.sqlite']}));
  for (const [name, value] of Object.entries({'README.md':'companion fixture','core.json':'{}','SOUL.md':'original role','USER.md':'original owner','COMPANION.md':'guidance',
    'data/memory/data/memory.db':'original Bank','data/emotion/state.json':'original emotion',
    'data/life/self.md':'original self','data/life/home.json':'original body','data/life/diary/2026-11-12.md':'diary',
    'data/pet-platform/pet/custom/animation.webm':'custom pack','data/life/album/photo.png':'photo'})) write(join(managed,name),value);
  mkdirSync(config.dataDir,{recursive:true});
  const db=new DatabaseSync(join(config.dataDir,'core.sqlite'));
  db.exec('CREATE TABLE records(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(kind,id))');
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  const workspace={id:'owner',path:repo,title:'fish'};
  const put=db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)');
  for(const [kind,value]of [['identity',{companionId:'fish',ownerActorId:'human'}],['preferences',{workspace}],['workspace-binding',{phase:'ready',target:workspace}]])put.run(kind,'current',JSON.stringify(value));
  const meta=db.prepare('INSERT INTO meta(key,value) VALUES (?,?)');
  meta.run('scope',JSON.stringify('scope'));meta.run('workspace.storage-id',JSON.stringify('stable-bank'));
  db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)').run('commitment','task',JSON.stringify({status:'original'}));db.close();
  write(join(profile,'node_modules','her-world','package.json'),'runtime version A');
  write(join(profile,'cordis.patch.yml'),'global settings A');
  const registryFile=join(home,'storages','workspace.json');
  write(registryFile,JSON.stringify({unit:{name:'workspace',version:1},global:{workspaceIds:['owner','other'],archivedSessionIds:['owner-old','other-old'],pinnedSessionIds:[],defaultWorkspaceId:'other'},
    tables:{workspaces:{owner:{path:repo,title:'fish',sessionIds:['owner-old']},other:{path:join(root,'unrelated'),title:'other',sessionIds:['other-old']}}}}));
  const input={repo,workspaceId:'owner',storageId:'stable-bank',profileDir:profile,dshHome:home,config};
  let plan=backupPlan(input);
  write(join(plan.channelsDirectory,'messaging.json'),'owner channel settings');
  write(join(plan.channelsDirectory,'conversations','guest-dir','local.txt'),'guest local');
  const registry=JSON.parse(read(registryFile));
  registry.tables.workspaces.guest={path:join(plan.channelsDirectory,'conversations','guest-dir'),title:'guest',sessionIds:['guest-old']}; registry.global.workspaceIds.push('guest');
  write(registryFile,JSON.stringify(registry)); plan=backupPlan(input);
  for (const entry of plan.roots.filter(root=>root.id.startsWith('sessions-'))) write(join(entry.path,'native','session.v4.jsonl.zstd'),entry.id+' old log');
  write(join(home,'attachments','v1','objects','ab','old'),'original shared image');
  const unrelated=join(home,'sessions','unrelated','log');write(unrelated,'unrelated log A');
  return {root,repo,home,profile,managed,registryFile,config,plan,input,unrelated};
}

test('offline recovery restores companion data/native history while retaining unrelated workspaces and settings',t=>{
  const f=fixture(t), backup=join(f.root,'backup');
  createOfflineBackup(f.plan,backup,noWriter);
  write(join(f.managed,'SOUL.md'),'changed role');write(join(f.managed,'data','memory','data','memory.db'),'new Bank');
  write(join(f.managed,'data','memory','new-fact'),'new fact');
  const ownerLog=f.plan.roots.find(root=>root.id==='sessions-owner');write(join(ownerLog.path,'native','session.v4.jsonl.zstd'),'longer native history');
  write(join(ownerLog.path,'new-session','session.v4.jsonl.zstd'),'new post-backup session');
  write(join(f.profile,'cordis.patch.yml'),'global settings B');write(f.unrelated,'unrelated log B');
  write(join(f.home,'attachments','v1','objects','cd','new'),'new unrelated shared image');
  const registry=JSON.parse(read(f.registryFile));
  registry.tables.workspaces.owner.sessionIds.push('new-session'); registry.tables.workspaces.other.sessionIds.push('other-new');
  registry.tables.workspaces.other.title='other updated';registry.global.archivedSessionIds.push('other-new');registry.global.pinnedSessionIds=['other-new'];
  write(f.registryFile,JSON.stringify(registry));
  const current=backupPlan(f.input);
  const result=restoreOfflineBackup(current,backup,join(f.root,'before'),noWriter);
  assert.equal(result.restored,true);assert.equal(read(join(f.managed,'SOUL.md')),'original role');
  assert.equal(read(join(f.managed,'data','memory','data','memory.db')),'original Bank');
  assert.equal(read(join(ownerLog.path,'native','session.v4.jsonl.zstd')),'sessions-owner old log');
  assert.equal(read(f.unrelated),'unrelated log B');assert.equal(read(join(f.profile,'cordis.patch.yml')),'global settings B');
  assert.equal(read(join(f.home,'attachments','v1','objects','cd','new')),'new unrelated shared image');
  const restored=JSON.parse(read(f.registryFile));
  assert.deepEqual(restored.tables.workspaces.owner.sessionIds,['owner-old']);
  assert.deepEqual(restored.tables.workspaces.other,registry.tables.workspaces.other);
  assert.deepEqual(restored.global.pinnedSessionIds,['other-new']);assert.ok(restored.global.archivedSessionIds.includes('other-new'));
  assert.equal(restored.global.defaultWorkspaceId,'other');
  assert.equal(read(join(f.root,'before','data','companion','payload','SOUL.md')),'changed role');
  assert.equal(read(join(f.root,'before','data','sessions-owner','payload','native','session.v4.jsonl.zstd')),'longer native history');
  verifyOfflineBackup(backup,backupPlan(f.input));
});

test('tampered payloads and different runtime packages fail before any restore writes',t=>{
  const f=fixture(t), backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  write(join(f.managed,'SOUL.md'),'keep current role');
  write(join(backup,'data','companion','payload','SOUL.md'),'corrupt');
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter),/Backup data changed/);
  assert.equal(read(join(f.managed,'SOUL.md')),'keep current role');
  write(join(backup,'data','companion','payload','SOUL.md'),'original role');
  write(join(f.profile,'node_modules','her-world','package.json'),'runtime version B');
  assert.throws(()=>verifyOfflineBackup(backup,f.plan),/matching plugin/);
});

test('live companion writers, source symlinks and overlapping destinations are refused',t=>{
  const f=fixture(t);
  write(join(f.config.dataDir,'core.lock'),String(process.pid)+':live');
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'live'),noWriter),/live writer/);
  rmSync(join(f.config.dataDir,'core.lock'));
  assert.throws(()=>createOfflineBackup(f.plan,join(f.managed,'backup'),noWriter),/overlaps/);
  symlinkSync(join(f.managed,'SOUL.md'),join(f.managed,'link'));
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'symlink'),noWriter),/Symlink/);
});

test('shared attachment collisions preserve current data and unrelated global registry fields',t=>{
  const f=fixture(t), backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  write(join(f.managed,'SOUL.md'),'current role');
  write(join(f.home,'attachments','v1','objects','ab','old'),'conflicting current image');
  const before=read(f.registryFile);
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'safety'),noWriter),/Shared attachment conflicts/);
  assert.equal(read(join(f.managed,'SOUL.md')),'current role');assert.equal(read(f.registryFile),before);
  assert.equal(read(join(f.home,'attachments','v1','objects','ab','old')),'conflicting current image');
});

test('a source changed during backup is rejected without publishing a partial snapshot',t=>{
  const f=fixture(t);let calls=0;
  assert.throws(()=>createOfflineBackup(f.plan,join(f.root,'backup'),{probe(){if(++calls===2)write(join(f.managed,'SOUL.md'),'concurrent write');}}),/Source changed/);
  assert.equal(read(join(f.managed,'SOUL.md')),'concurrent write');
});

test('an edited inventory cannot omit selected logs or change another workspace archive state',t=>{
  const f=fixture(t),backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  const file=join(backup,'manifest.json'),original=JSON.parse(read(file));
  const incomplete=structuredClone(original);incomplete.roots=incomplete.roots.filter(root=>root.id!=='sessions-owner');
  write(file,JSON.stringify(incomplete));assert.throws(()=>verifyOfflineBackup(backup,f.plan),/lacks selected native logs/);
  const changed=structuredClone(original);changed.workspace.archived.push('other-old');write(file,JSON.stringify(changed));
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter),/outside selected sessions/);
  assert.equal(read(join(f.managed,'SOUL.md')),'original role');
});

for(const outcome of ['sent','uncertain'])test(`restoring a pending Qzone snapshot retains current ${outcome} outcome and does not publish again`,async t=>{
  const f=fixture(t),{createQzoneLedger}=await import('../../dist/src/channels/group-qzone.js');
  const text='这是已经由主人确认发布的测试草稿。';let now=Date.UTC(2026,10,12,4);
  let ledger=createQzoneLedger(f.plan.channelsDirectory,'12345',()=>now);
  const initial=ledger.manage('qzoneState');
  ledger.manage('qzoneSettings',{expected:initial.settings,next:{enabled:true,times:['00:00','00:01'],dailyMax:10}});
  ledger.manage('qzoneDraft',{text});
  const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  await ledger.publish(text,[],async()=>{if(outcome==='uncertain')throw Error('ambiguous fixture response');return {tid:'fixture-confirmed'};}).catch(error=>{assert.equal(outcome,'uncertain');assert.match(error.message,/ambiguous/);});
  const current=read(join(f.plan.channelsDirectory,'qzone-12345','published.json'));
  now+=3600000;const result=restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter);
  assert.ok(result.preservedJournals.includes('channels/qzone-12345/published.json'));
  assert.equal(read(join(f.plan.channelsDirectory,'qzone-12345','published.json')),current);
  ledger=createQzoneLedger(f.plan.channelsDirectory,'12345',()=>now);let replayed=0;
  await ledger.tick([],async()=>{replayed++;return {tid:'must-not-publish'};});
  assert.equal(replayed,0);const state=ledger.manage('qzoneState');
  assert.equal(state.drafts[0].status,outcome);assert.equal(state.posts[0].status,outcome);assert.equal(state.quota.todayCount,1);
});

test('current Core delivery/deduplication/usage records and Life spend survive while ordinary data rolls back',t=>{
  const f=fixture(t),core=join(f.config.dataDir,'core.sqlite'),life=join(f.managed,'data','life','life.json');
  const kinds=['channel-received','channel-reach','life-outlet-delivery','channel-usage','channel-usage-event'];
  let db=new DatabaseSync(core);const put=db.prepare('INSERT OR REPLACE INTO records(kind,id,value) VALUES (?,?,?)');
  for(const kind of kinds)put.run(kind,'old',JSON.stringify({state:'pending',requests:1}));
  put.run('desktop-session','stable-bank',JSON.stringify('owner-old'));db.close();
  write(life,JSON.stringify({version:1,homeSessionId:'old-home',alarm:{text:'old alarm'},spend:{day:'2026-11-12',yuan:0.1}}));
  const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  db=new DatabaseSync(core);const update=db.prepare('UPDATE records SET value=? WHERE kind=? AND id=?');
  for(const kind of kinds)update.run(JSON.stringify({state:'sent',requests:7}),kind,'old');
  db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)').run('channel-received','new',JSON.stringify({state:'done'}));
  update.run(JSON.stringify({status:'future'}),'commitment','task');
  update.run(JSON.stringify('new-desktop'),'desktop-session','stable-bank');db.close();
  write(life,JSON.stringify({version:1,homeSessionId:'future-home',alarm:{text:'future alarm'},spend:{day:'2026-11-12',yuan:1.7,reminded:true}}));
  const result=restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter);
  db=new DatabaseSync(core,{readOnly:true});
  try {
    for(const kind of kinds)assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,'old').value),{state:'sent',requests:7});
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM records WHERE kind='channel-received' AND id='new'").get().value),{state:'done'});
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM records WHERE kind='commitment' AND id='task'").get().value),{status:'original'});
    assert.equal(JSON.parse(db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get('desktop-session','stable-bank').value),'owner-old');
  }finally{db.close();}
  const restored=JSON.parse(read(life));assert.equal(restored.homeSessionId,'old-home');assert.deepEqual(restored.alarm,{text:'old alarm'});
  assert.deepEqual(restored.spend,{day:'2026-11-12',yuan:1.7,reminded:true});assert.ok(result.preservedJournals.includes('life/life.json:spend'));
});

test('WeChat current jobs and their actual WAL/SHM group are retained together',t=>{
  const f=fixture(t),file=join(f.plan.channelsDirectory,'wechat-'+ 'a'.repeat(24),'wechat-outbox.sqlite');
  mkdirSync(dirname(file),{recursive:true});let db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,confirmed INTEGER)');
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run('one','queued',0);db.close();
  const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  const crash=spawnSync(process.execPath,['-e',`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.prepare('UPDATE jobs SET status=?,confirmed=? WHERE id=?').run('sent',1,'one');db.prepare('INSERT INTO jobs VALUES (?,?,?)').run('two','uncertain',0);process.kill(process.pid,'SIGKILL');`,file],{stdio:'pipe'});
  assert.equal(crash.signal,'SIGKILL');const expected=Object.fromEntries(['','-wal','-shm'].map(suffix=>[suffix,readFileSync(file+suffix)]));
  const result=restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter);
  for(const [suffix,bytes]of Object.entries(expected))assert.deepEqual(readFileSync(file+suffix),bytes);
  db=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(db.prepare('SELECT status,confirmed FROM jobs ORDER BY id').all().map(row=>({...row})),[{status:'sent',confirmed:1},{status:'uncertain',confirmed:0}]);}finally{db.close();}
  assert.ok(result.preservedJournals.some(name=>name.endsWith('wechat-outbox.sqlite-wal')));
});

for(const journal of ['qzone-12345/published.json','wechat-'+ 'b'.repeat(24)+'/wechat-outbox.sqlite'])test(`missing current ${journal} requires reconciliation instead of re-enabling an old queue`,t=>{
  const f=fixture(t),file=join(f.plan.channelsDirectory,journal);
  write(file,JSON.stringify({drafts:[{id:'draft',status:'pending'}],posts:[]}));
  const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);rmSync(file);
  write(join(f.managed,'SOUL.md'),'keep current persona');
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'before'),noWriter),/Reconcile actual deliveries/);
  assert.equal(read(join(f.managed,'SOUL.md')),'keep current persona');
});

test('missing processed-message records or Life spend cannot be recovered from older knowledge silently',t=>{
  const f=fixture(t),core=join(f.config.dataDir,'core.sqlite'),life=join(f.managed,'data','life','life.json');
  let db=new DatabaseSync(core);db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)').run('channel-received','one','{"state":"done"}');db.close();
  write(life,JSON.stringify({version:1,spend:{day:'2026-11-12',yuan:0.5}}));
  const backup=join(f.root,'backup');createOfflineBackup(f.plan,backup,noWriter);
  db=new DatabaseSync(core);db.exec("DELETE FROM records WHERE kind='channel-received'");db.close();
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'before-records'),noWriter),/Reconcile actual deliveries/);
  db=new DatabaseSync(core);db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)').run('channel-received','one','{"state":"done"}');db.close();
  write(life,JSON.stringify({version:1}));
  assert.throws(()=>restoreOfflineBackup(f.plan,backup,join(f.root,'before-spend'),noWriter),/spend.*Reconcile actual deliveries/);
});
