import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { inspectRepoBinding } from '../../scripts/lib/repo-storage.mjs';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { offlineFixture } from './offline-helpers.mjs';
import { refusedInventory } from './helpers.mjs';

test('binding and inventory preserve the stopped WAL database and its directory', async t => {
  const f = await offlineFixture(t, false), directory = f.config.dataDir;
  const wal = join(directory, 'core.sqlite-wal');
  assert.equal(statSync(wal, { throwIfNoEntry: false })?.size ?? 0, 0);
  for (const suffix of ['-wal', '-shm']) rmSync(join(directory, 'core.sqlite' + suffix), {force:true});
  const snapshot = () => ['', ...readdirSync(directory).sort()].map(name => {
    const { mtimeNs, size } = statSync(join(directory, name), { bigint: true });
    return [name, mtimeNs, size];
  });
  assert.ok(!readdirSync(directory).some(name => /core\.sqlite-(wal|shm)$/.test(name)));
  const before = snapshot();
  assert.equal(inspectRepoBinding(f.config).state, 'ready');
  assert.deepEqual(snapshot(), before, 'opening the binding must preserve the source');
  const report = inventory(f.installation);
  assert.ok(report.files.some(file => file.path.endsWith('/core.sqlite')));
  assert.deepEqual(snapshot(), before, 'inventory must preserve the stopped database and directory');
});

test('binding inspection includes committed WAL frames without opening the source', async t => {
  const f = await offlineFixture(t, false), file = join(f.config.dataDir, 'core.sqlite');
  const result = spawnSync(process.execPath, ['--input-type=module','-e',`
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('workspace.storage-id', JSON.stringify('wal-storage-fixture'));
    db.prepare('INSERT INTO records(kind,id,value) VALUES (?,?,?)').run('synthetic-wal-kind','fixture','true');
    process.kill(process.pid,'SIGKILL');
  `,file],{encoding:'utf8'});
  assert.equal(result.signal,'SIGKILL',result.stderr);
  assert.ok(statSync(file + '-wal').size > 32);
  const snapshot = () => ['', '-wal', '-shm'].map(suffix => {
    const {mtimeNs, size} = statSync(file + suffix,{bigint:true});
    return {mtimeNs, size};
  });
  const before = snapshot();
  assert.equal(inspectRepoBinding(f.config).storageId,'wal-storage-fixture');
  const report = inventory(f.installation);
  assert.ok(report.files.some(row => row.path.endsWith('/core.sqlite-wal')));
  assert.equal(report.files.find(row => row.path.endsWith('/core.sqlite')).unknownKinds,1);
  assert.deepEqual(snapshot(),before);
});

test('binding inspection rejects a live external Core lease before reading SQLite', async t => {
  const f = await offlineFixture(t,false), child = spawn(process.execPath,['-e','setInterval(() => {}, 1000)']);
  t.after(async () => { const stopped = once(child,'exit'); child.kill('SIGKILL'); await stopped; });
  await once(child,'spawn');
  writeFileSync(join(f.config.dataDir,'core.lock'),`${child.pid}:fixture`);
  assert.throws(() => inspectRepoBinding(f.config), /core still has a live writer/);
  refusedInventory(f,['--installation',f.installation],'writer-running');
});
