import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONSOLE_WALLET_IMPORT_FILE} from '../../dist/src/core/storage-migration.js';
import {createCore} from '../../dist/src/core/index.js';
import {CompanionEconomy} from '../../dist/src/living/economy/plugin.js';
import {createOfflineBackup} from '../../scripts/lib/offline-backup.mjs';
import {exportWalletSources} from '../../scripts/migrate/browser-wallet.mjs';
import {migrationStatus, runMigration, steps, verifyWalletImport} from '../../scripts/migrate/runner.mjs';
import {sealWalletRollback, walletBinding} from '../../scripts/migrate/wallet-rollback.mjs';
import {mockDsh, planFor, read} from './helpers.mjs';
import {economyPaths, offlineFixture} from './offline-helpers.mjs';

async function legacy(t, adopted) {
  mockDsh(t);
  const f = await offlineFixture(t, false, {withLegacyEconomy:adopted});
  await runMigration({installation:f.installation, backup:join(f.out,'v3-resume')}, steps.slice(0, 3));
  const manifest = join(f.data,'storage-manifest.json');
  assert.equal(read(manifest).modules.living, 3);
  assert.equal(migrationStatus(f.installation).segment, 'settled');
  return {...f, manifest};
}

async function prepare(f, pending) {
  const directory = join(f.out, 'private');
  mkdirSync(directory, {mode:0o700});
  const walletExport = join(directory,'export.json'), walletRollback = join(directory,'rollback.json');
  const plan = planFor(f), binding = walletBinding(plan);
  const sources = [{profile:f.profile, origin:'https://fixture.invalid', key:'chatpet:economy:pending:' + f.target.id}];
  const raw = pending ? JSON.stringify({endpoint:'economyAction', requestId:'original-credit',
    input:{workspaceId:f.target.id, action:{kind:'grant', amount:2}}}) : null;
  await exportWalletSources({file:walletExport, binding, round:randomUUID(), sources,
    acquire:async () => ({assertFrozen:() => true, read:() => raw})});
  const backup = join(f.out,'old-backup');
  createOfflineBackup(plan, backup);
  sealWalletRollback({installation:f.installation, backup, walletExport, output:walletRollback});
  writeFileSync(join(plan.installedPackage,'upgrade-marker.txt'), 'SYNTHETIC_UPGRADE');
  return {installation:f.installation, walletExport, walletRollback};
}

test('未采用钱包的 v3 缺导出就拒绝，明确空来源留下独立证明且保持无钱包', async t => {
  const f = await legacy(t, false);
  const backup = join(f.out,'resume-v4');
  await assert.rejects(runMigration({installation:f.installation, backup}), {code:'wallet-export-missing'});
  assert.equal(existsSync(backup), false);
  const inputs = await prepare(f, false);
  await runMigration({...inputs, backup});
  assert.equal(verifyWalletImport(inputs), true);
  const marker = join(f.data,CONSOLE_WALLET_IMPORT_FILE);
  assert.equal(read(marker).wallet, 'absent');
  assert.equal(read(marker).requestCount, 0);
  assert.equal(read(marker).sourceCount, 1);
  assert.equal(existsSync(economyPaths(f).database), false);
  assert.equal(read(f.manifest).modules.living, 4);
});

test('未采用钱包的 v3 拒绝有请求的浏览器来源', async t => {
  const f = await legacy(t, false);
  const inputs = await prepare(f, true);
  const backup = join(f.out,'resume-v4');
  await assert.rejects(runMigration({...inputs, backup}), {code:'wallet-not-adopted'});
  assert.equal(existsSync(backup), false);
  assert.equal(existsSync(economyPaths(f).database), false);
  assert.equal(read(f.manifest).modules.living, 3);
});

test('存量钱包的已结清导入在私有导出封窗后仍可查历史证明', async t => {
  const f = await legacy(t, true);
  const inputs = await prepare(f, true);
  await runMigration({...inputs, backup:join(f.out,'resume-v4')});
  assert.equal(verifyWalletImport(inputs), true);
  const host = createCore(f.config), economy = new CompanionEconomy({},host);
  try {
    assert.equal(host.workspace.status().state, 'ready');
    economy.prepare(f.target);
    const id = f.target.id, signal = new AbortController().signal;
    const recover = (rpc, requestId) => economy.consoleRecover(rpc, id, requestId, false, signal, () => {});
    assert.deepEqual(await recover('economyCheck','original-credit'),{state:'no-evidence'});
    assert.deepEqual(await recover('economyRetry','original-credit'),{state:'committed'});
    assert.deepEqual(await recover('economyPending',''),[]);
    assert.equal((await economy.snapshot(id)).ledger.filter(row => row.requestId === 'original-credit').length,1);
  } finally {
    economy.close();
    await host.close();
  }
  assert.throws(() => verifyWalletImport(inputs), {code:'migration-inconsistent'});
  rmSync(inputs.walletExport);
  rmSync(inputs.walletRollback);
  const current = migrationStatus(f.installation);
  assert.equal(current.segment, 'settled');
  assert.deepEqual(current.steps.at(-1), {id:'0004-console-wallet',state:'complete'});
  await runMigration({installation:f.installation, resume:true});
});
