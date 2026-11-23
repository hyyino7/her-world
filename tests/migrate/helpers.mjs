import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { content } from '../../scripts/fixtures/synthetic-companion.mjs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { generateSynthetic, value } from '../../scripts/fixtures/synthetic-companion.mjs';
import { createCore } from '../../dist/src/core/index.js';
import { backupPlan, createOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { CONSOLE_WALLET_IMPORT_FILE } from '../../dist/src/core/storage-migration.js';
import { sealWalletRollback, walletBinding } from '../../scripts/migrate/wallet-rollback.mjs';
import { legacyEconomy } from './offline-helpers.mjs';

export const variants = ['current','legacy'];
export function mockDsh(t, running = false) {
  const original = childProcess.spawnSync;
  const mocked = t.mock.method(childProcess, 'spawnSync', (command, args, options) => command === 'pgrep'
    ? {status:running ? 0 : 1, stdout:running ? String(process.pid + 100000) : '', stderr:''}
    : original(command, args, options));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}
export async function fixture(t, variant, {keepStorageManifest = false} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-synthetic-')));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const result = await generateSynthetic(join(root, 'installed'), variant);
  if (!keepStorageManifest) {
    rmSync(join(result.data, 'storage-manifest.json'));
    rmSync(join(result.data, CONSOLE_WALLET_IMPORT_FILE),{force:true});
    legacyEconomy(result);
  }
  return result;
}
export function planFor(f) {
  return backupPlan({repo:f.repo,workspaceId:f.target.id,storageId:f.storageId,profileDir:f.profile,dshHome:f.home,config:f.config});
}
export function emptyWalletMigrationInputs(f) {
  const plan = planFor(f), binding = walletBinding(plan), directory = join(f.out,'wallet-private');
  mkdirSync(directory,{mode:0o700});
  const walletExport = join(directory,'export.json'), walletRollback = join(directory,'rollback.json');
  const sources = [{profile:f.profile,origin:'https://fixture.invalid',key:'chatpet:economy:pending:' + f.target.id,
    raw:null,rawDigest:null}];
  writeFileSync(walletExport,JSON.stringify({format:1,binding,round:randomUUID(),sources}) + '\n',{mode:0o600,flag:'wx'});
  const backup = join(f.out,'wallet-rollback-backup');
  createOfflineBackup(plan,backup);
  sealWalletRollback({installation:f.installation,backup,walletExport,output:walletRollback});
  writeFileSync(join(plan.installedPackage,'upgrade-marker.txt'),'SYNTHETIC_UPGRADE');
  return {walletExport,walletRollback};
}
export const read = file => JSON.parse(readFileSync(file, 'utf8'));
export async function coreReady(f) {
  const host = createCore(f.config);
  try {
    const state = value(await host.services.workspace.inspect(host.operator.request('inspect'), {}));
    assert.equal(state.state, 'ready');
    assert.equal(host.workspace.storageId(), f.storageId);
    assert.equal(value(await host.services.core.getIdentity(host.operator.request('identity'), {})).companionId, f.config.companionId);
    assert.equal((await host.records.readSelf(f.target.id)).text, 'SYNTHETIC_SELF_817');
  } finally { await host.close(); }
}
export async function recall(f) {
  const host = createCore(f.config);
  try {
    const result = await host.native.memory.findForOwner(f.target.id, 'SYNTHETIC_JASMINE_817');
    assert.ok(result.items.some(row => row.id === f.memoryId));
    assert.ok(!(await host.native.memory.findForOwner(f.target.id, 'SYNTHETIC_WITHDRAWN_817')).items.some(row => row.id === f.withdrawnId));
  } finally { await host.close(); }
}
export async function coreAtLegacyVersion(f) {
  const host = createCore(f.config);
  try {
    const state = value(await host.services.workspace.inspect(host.operator.request('inspect-before-home-migration'), {}));
    assert.equal(state.state, 'migration-required');
    assert.equal(state.migrationReason, 'storage-version-outdated');
  } finally { await host.close(); }
}
export function memoryLogical(f) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-memory-')));
  const source = join(f.data, 'memory/data/memory.db'), copy = join(root, 'memory.db');
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      try { cpSync(source + suffix, copy + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const db = new DatabaseSync(copy);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name}) => [name,
        db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort()]);
    } finally { db.close(); }
  } finally { rmSync(root, {recursive:true, force:true}); }
}

export function cli(f, args, {inventory = false, running = false} = {}) {
  return childProcess.spawnSync(process.execPath, ['--import',resolve('tests/migrate/dsh-probe.mjs'),
    resolve(inventory ? 'scripts/migrate/inventory.mjs' : 'scripts/migrate/companion-migrate.mjs'), ...args],
    {encoding:'utf8', env:{...process.env, MIGRATE_TEST_DSH_RUNNING:running ? '1' : '0'}});
}
export function refusedCli(f, args, code, options) {
  const result = cli(f,args,options);
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  const output = JSON.parse(result.stderr);
  assert.equal(output.code,code);
  assert.equal(typeof output.message,'string');
  for (const secret of [...Object.values(content),f.config.companionId,f.config.scopeId,f.config.ownerActorId,
    f.target.id,f.storageId,f.out,f.repo,f.home,f.installation]) assert.ok(!result.stderr.includes(secret),'Refusal exposes data');
  return output;
}
