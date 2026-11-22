import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runMigration, migrationStatus } from '../../scripts/migrate/runner.mjs';
import { verifyOfflineBackup, restoreOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { hash } from '../../scripts/migrate/io.mjs';
import { variants, fixture, planFor, mockDsh, coreAtLegacyVersion, coreReady, recall, memoryLogical, read, emptyWalletMigrationInputs } from './helpers.mjs';
import { bootstrapSteps, selectBootstrapCli } from './migration-child.mjs';

for (const variant of variants) test(`${variant}: migration, actual recall and protected-journal rollback`, {timeout:60000}, async t => {
  selectBootstrapCli(t);
  mockDsh(t); const f = await fixture(t, variant), backup = join(f.out, 'backup');
  await coreAtLegacyVersion(f); const before = memoryLogical(f);
  const manifestBefore = readFileSync(join(f.managed, 'manifest.json'));
  assert.deepEqual(migrationStatus(f.installation, bootstrapSteps), {
    steps:[{id:'0001-storage-manifest',state:'pending'}], truncated:false, segment:'none',
  });
  const cli = ['--import',resolve('tests/migrate/dsh-probe.mjs'),resolve('scripts/migrate/companion-migrate.mjs')];
  const executed = spawnSync(process.execPath,[...cli,'run','--installation',f.installation,'--backup',backup],{encoding:'utf8'});
  assert.equal(executed.status,0,executed.stderr);
  assert.deepEqual(JSON.parse(executed.stdout).steps,[{id:'0001-storage-manifest',state:'complete'}]);
  for (const command of ['plan','status']) {
    const result = spawnSync(process.execPath,[...cli,command,'--installation',f.installation],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).steps,command === 'plan' ? [] : [{id:'0001-storage-manifest',state:'complete'}]);
    assert.ok(!result.stdout.includes(f.config.companionId));
  }
  const originalLease = readFileSync(join(backup,'data/companion/payload/data/migration.lock'));
  const version = read(join(f.data, 'storage-manifest.json'));
  assert.equal(version.schemaVersion, 1); assert.equal(version.companionId, f.config.companionId);
  const journalFile = join(f.data, 'migrations.jsonl'), journal = readFileSync(journalFile,'utf8');
  const header = JSON.parse(journal.split('\n')[0]);
  assert.equal(header.backup, backup); assert.equal(header.backupHash, hash(readFileSync(join(backup,'manifest.json'))));
  verifyOfflineBackup(backup, planFor(f));
  assert.deepEqual(memoryLogical(f), before, 'Migration never changes Bank logical content');
  await coreAtLegacyVersion(f);
  assert.deepEqual(readFileSync(join(f.managed,'manifest.json')), manifestBefore, 'Identity fingerprint is untouched');
  assert.equal(migrationStatus(f.installation, bootstrapSteps).steps[0].state, 'complete');
  await runMigration({installation:f.installation,resume:true}, bootstrapSteps);
  assert.equal(readFileSync(journalFile,'utf8'),journal);
  // Actual restore keeps latest delivery/quota receipts and spend, and treats
  // profile configuration as a reference rather than a replacement root.
  const db = new DatabaseSync(join(f.config.dataDir,'core.sqlite'));
  db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?)').run('channel-usage-event','after-migration','true'); db.close();
  const life = read(join(f.data,'life/life.json')); life.spend = {day:'2026-01-01',yuan:2};
  writeFileSync(join(f.data,'life/life.json'),JSON.stringify(life));
  writeFileSync(join(f.profile,'cordis.patch.yml'),'# Later synthetic settings\n');
  const result = restoreOfflineBackup(planFor(f),backup,join(f.out,'before-restore'));
  assert.ok(result.preservedJournals.includes('core records:channel-usage-event'));
  assert.equal(existsSync(join(f.data,'storage-manifest.json')),false);
  assert.equal(existsSync(join(f.data,'migrations.jsonl')),false);
  assert.deepEqual(readFileSync(join(f.data,'migration.lock')),originalLease,'Shared restore retains the backed-up lease; verify no migration is running before removing it');
  assert.equal(read(join(f.data,'life/life.json')).spend.yuan,2);
  assert.match(readFileSync(join(f.profile,'cordis.patch.yml'),'utf8'),/Later/);
  assert.deepEqual(memoryLogical(f),before);
  await coreAtLegacyVersion(f);
  await runMigration({installation:f.installation,backup:join(f.out,'full-migration'),...emptyWalletMigrationInputs(f)});
  await coreReady(f); await recall(f);
});
