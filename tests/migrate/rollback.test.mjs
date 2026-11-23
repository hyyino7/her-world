import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectRepoBinding } from '../../scripts/lib/repo-storage.mjs';
import { verifyOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { planFor, coreReady, read } from './helpers.mjs';
import { offlineFixture } from './offline-helpers.mjs';

function run(args) {
  const [script,...options] = args;
  return spawnSync(process.execPath,['--import',resolve('tests/migrate/dsh-probe.mjs'),resolve(script),...options],{encoding:'utf8'});
}
const checked = result => { assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout || 'null'); };
const write = (file,text) => { mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,text); };

test('0.5.0 同包恢复保留绑定、原生日志和不可逆状态', {timeout:30000}, async t => {
  const f = await offlineFixture(t,false,{keepStorageManifest:true}), plan = planFor(f);
  const backup = (...args) => run(['scripts/companion-backup.mjs',...args,'--installation',f.installation]);
  const old = join(f.out,'same-package');
  const restore = (source, name) => backup('restore','--backup',source,'--before',join(f.out,name));
  const manifest = join(f.data,'storage-manifest.json'), manifestBefore = readFileSync(manifest);
  const nativeLog = join(plan.roots.find(root => root.id.startsWith('sessions-')).path,'fixture-session/session.v4.jsonl.zstd');
  const cache = join(plan.cacheDirectory,'fixture-session.json');
  const attachment = join(plan.attachmentsDirectory,'v1/objects/00/fixture');
  const addedAttachment = join(plan.attachmentsDirectory,'v1/objects/00/later');
  const devicePatch = join(f.profile,'cordis.patch.yml'), instructions = join(f.repo,'AGENTS.md');
  const home = join(f.data,'life/life.json'), dbFile = join(f.config.dataDir,'core.sqlite');
  const pkg = join(plan.installedPackage,'package.json');
  const packageVersion = version => writeFileSync(pkg,JSON.stringify({name:'her-world',version,synthetic:true}));
  packageVersion('0.5.0');
  write(attachment,'SYNTHETIC_ATTACHMENT');
  write(home,JSON.stringify({homeSessionId:'fixture-session',spend:{day:'2026-01-02',yuan:1}}));
  write(join(f.managed,'self.md'),'SYNTHETIC_SELF_817');
  const codeBefore = readFileSync(pkg), oldBindings = readFileSync(f.installation);
  const original = [nativeLog,cache,attachment,instructions].map(path => readFileSync(path));
  const registry = read(plan.registryFile);
  const bindingQuery = "SELECT value FROM records WHERE kind='workspace-binding' AND id='current'";
  const readBinding = db => JSON.parse(db.prepare(bindingQuery).get().value);

  checked(backup('create','--output',old));
  const fingerprint = verifyOfflineBackup(old,planFor(f)).codeFingerprint;
  packageVersion('0.6.0');
  assert.notEqual(restore(old,'wrong-package').status,0);
  assert.equal(existsSync(join(f.out,'wrong-package')),false);
  packageVersion('0.5.0');
  assert.equal(verifyOfflineBackup(old,planFor(f)).codeFingerprint,fingerprint);

  write(nativeLog,'SYNTHETIC_NEW_NATIVE_LOG'); write(cache,'{}'); rmSync(attachment);
  write(addedAttachment,'SYNTHETIC_NEW_ATTACHMENT');
  write(devicePatch,'# Current device settings'); write(instructions,'# After upgrade');
  const modifiedRegistry = read(plan.registryFile);
  modifiedRegistry.global.pinnedSessionIds.push('fixture-session');
  modifiedRegistry.tables.workspaces[f.target.id].title = 'New fixture title';
  write(plan.registryFile,JSON.stringify(modifiedRegistry));
  const after = [['life-outlet-delivery','delivery'],['channel-usage-event','quota']];
  const db = new DatabaseSync(dbFile);
  let originalBinding;
  try {
    originalBinding = readBinding(db);
    db.prepare("UPDATE records SET value=? WHERE kind='workspace-binding' AND id='current'")
      .run(JSON.stringify({...originalBinding,revision:originalBinding.revision + 1}));
    for (const row of after) db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?)').run(...row,'true');
  }
  finally { db.close(); }
  write(home,JSON.stringify({...read(home),homeSessionId:'new-home',spend:{day:'2026-01-02',yuan:4}}));
  const rolledBack = checked(restore(old,'before-rollback'));
  assert.equal(rolledBack.restored,true);
  assert.deepEqual(readFileSync(pkg),codeBefore);
  assert.deepEqual(readFileSync(f.installation),oldBindings);
  assert.equal(inspectRepoBinding(f.config).storageId,f.storageId);
  assert.equal(inspectRepoBinding(f.config).target.id,f.target.id);
  assert.deepEqual(read(plan.registryFile),registry);
  assert.deepEqual([nativeLog,cache,attachment,instructions].map(path => readFileSync(path)),original);
  const sessionRoot = plan.roots.find(root => root.id.startsWith('sessions-'));
  assert.equal(readFileSync(join(f.out,'before-rollback','data',sessionRoot.id,'payload','fixture-session/session.v4.jsonl.zstd'),'utf8'),
    'SYNTHETIC_NEW_NATIVE_LOG');
  assert.equal(readFileSync(addedAttachment,'utf8'),'SYNTHETIC_NEW_ATTACHMENT');
  assert.equal(readFileSync(devicePatch,'utf8'),'# Current device settings');
  assert.equal(readFileSync(join(old,'data/profile-patch/payload'),'utf8'),'# Synthetic metadata fixture\n');
  assert.deepEqual(readFileSync(manifest),manifestBefore);
  assert.equal(read(home).homeSessionId,'fixture-session');
  assert.equal(read(home).spend.yuan,4);
  assert.ok(after.every(([kind]) => rolledBack.preservedJournals.includes('core records:' + kind)));
  const reopened = new DatabaseSync(dbFile);
  try {
    assert.deepEqual(readBinding(reopened),originalBinding);
    for (const row of after) assert.equal(reopened.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(...row).value,'true');
  } finally { reopened.close(); }
  await coreReady(f);
});
