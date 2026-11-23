import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createOfflineBackup} from '../../scripts/lib/offline-backup.mjs';
import {offlineFixture} from './offline-helpers.mjs';
import {planFor} from './helpers.mjs';

const restoreCommand = (f, backup, before) => ['--import',resolve('tests/migrate/dsh-probe.mjs'),
  resolve('scripts/companion-backup.mjs'),'restore','--installation',f.installation,'--backup',backup,'--before',before];

test('同一仓库的两个 restore 进程只有一个能持有互斥锁', {timeout:30000}, async t => {
  const f = await offlineFixture(t,false,{keepStorageManifest:true});
  const backup = join(f.out,'backup'), gate = join(f.out,'restore-gate');
  createOfflineBackup(planFor(f),backup,{probe() {}});
  const original = join(f.managed,'SOUL.md'), saved = readFileSync(original);
  writeFileSync(original,'current role');
  const first = spawn(process.execPath,['--import',resolve('tests/migrate/lock-gate.mjs'),
    ...restoreCommand(f,backup,join(f.out,'before-first'))],{
    env:{...process.env, MIGRATE_TEST_RESTORE_GATE:gate},stdio:['ignore','pipe','pipe','ipc']});
  t.after(() => { if (first.exitCode === null && first.signalCode === null) first.kill('SIGKILL'); });
  let stderr = '';
  first.stderr.on('data',chunk => { stderr += chunk; });
  const done = once(first,'close');
  const [ready] = await Promise.race([once(first,'message'),done.then(() => { throw Error(stderr); })]);
  assert.equal(ready.held,true);
  const second = join(f.out,'before-second');
  const refused = spawnSync(process.execPath,restoreCommand(f,backup,second),{encoding:'utf8'});
  assert.equal(refused.status,1,refused.stderr);
  assert.match(refused.stderr,/Migration or restore is running/);
  assert.equal(existsSync(second),false);
  assert.equal(readFileSync(original,'utf8'),'current role');
  writeFileSync(gate,'continue');
  assert.equal((await done)[0],0,stderr);
  assert.deepEqual(readFileSync(original),saved);
  assert.equal(spawnSync(process.execPath,restoreCommand(f,backup,second),{encoding:'utf8'}).status,0);
  assert.ok(existsSync(second));
});

test('restore 拒绝仍有持有者的历史锁并允许已退出进程留下的锁', async t => {
  const f = await offlineFixture(t,false,{keepStorageManifest:true});
  const lock = join(f.data,'migration.lock'), backup = join(f.out,'backup'), before = join(f.out,'before');
  createOfflineBackup(planFor(f),backup,{probe() {}});
  const lease = `${process.pid}:history`;
  const restore = () => spawnSync(process.execPath,restoreCommand(f,backup,before),{encoding:'utf8'});
  for (const [text,reason] of [[lease,/Migration or restore is running/],['invalid',/Invalid migration lock/]]) {
    writeFileSync(lock,text);
    const refused = restore();
    assert.equal(refused.status,1,refused.stderr);
    assert.match(refused.stderr,reason);
    assert.ok(!refused.stderr.includes(lease));
    assert.ok(!refused.stderr.includes(lock));
    assert.equal(readFileSync(lock,'utf8'),text);
    assert.equal(existsSync(before),false);
  }
  const dead = spawn(process.execPath,['-e','']);
  await once(dead,'exit');
  writeFileSync(lock,`${dead.pid}:history`);
  const restored = restore();
  assert.equal(restored.status,0,restored.stderr);
  assert.equal(existsSync(lock),false);
});
