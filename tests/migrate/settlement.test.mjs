import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONSOLE_WALLET_IMPORT_FILE } from '../../dist/src/core/storage-migration.js';
import { createCore } from '../../dist/src/core/index.js';
import { PersistentLifePlan } from '../../dist/src/living/plan/plan.js';
import { openDomains } from '../../scripts/fixtures/synthetic-companion.mjs';
import { runMigration } from '../../scripts/migrate/runner.mjs';
import { createOfflineBackup, restoreOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { variants, fixture, mockDsh, planFor, read, emptyWalletMigrationInputs } from './helpers.mjs';
import { legacyEconomy } from './offline-helpers.mjs';

for (const variant of variants) test(`${variant}: pending Body effect settles identically across migration`, {timeout:60000}, async t => {
  mockDsh(t); const f = await fixture(t,variant,{keepStorageManifest:true});
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const file = join(f.data,'economy/economy.sqlite');
  const sql = text => {const db = new DatabaseSync(file);try {db.exec(text);} finally {db.close();}};
  const manifest = join(f.data,'storage-manifest.json');
  let host = createCore(f.config), domains = openDomains(host);
  const plan = () => new PersistentLifePlan(join(f.data,'life'),f.config.companionId,f.storageId,'UTC');
  let planId, effect;
  try {
    await domains.body.setAutonomy(f.target.id,true);
    await plan().commit(1,{goal:'fixture meal',reason:'fixture',steps:[{id:'eat',kind:'economy',activity:'fixture',economy:{type:'consume',itemId:'food:improved-meal',quantity:1}}],nextConsiderAt:null});
    planId = plan().read().plan.id;
    sql("CREATE TRIGGER reject_consumption BEFORE UPDATE ON uses WHEN json_extract(NEW.value,'$.status')='consumed' BEGIN SELECT RAISE(ABORT,'synthetic pending settlement'); END");
    const before = (await domains.body.snapshot(f.target.id)).needs.hunger;
    await plan().advance(f.target.id,domains.body);
    effect = (await domains.body.snapshot(f.target.id)).needs.hunger;
    assert.ok(effect < before);
    assert.equal((await domains.economy.snapshot(f.target.id)).pendingUses.length,1);
    assert.equal(plan().read().plan.cursor,0);
  } finally { await domains.close(); await host.close(); }
  sql('DROP TRIGGER reject_consumption');
  const pending = join(f.out,'pending-backup'); createOfflineBackup(planFor(f),pending);
  async function recover() {
    host = createCore(f.config); domains = openDomains(host);
    try {
      await domains.body.setAutonomy(f.target.id,true);
      await plan().advance(f.target.id,domains.body);
      const body = await domains.body.snapshot(f.target.id), economy = await domains.economy.snapshot(f.target.id);
      const receipt = await domains.body.inspectPlanned(f.target.id,`life:${planId}:eat`);
      assert.equal(plan().read().plan.id,planId); assert.equal(plan().read().plan.cursor,1);
      assert.equal(receipt.status,'completed'); assert.equal(body.needs.hunger,effect);
      assert.equal(economy.pendingUses.length,0);
      const quantity = economy.inventory.find(row => row.itemId === 'food:improved-meal').quantity;
      const debits = economy.ledger.filter(row => row.kind === 'use-consume').length;
      assert.equal(quantity,1); assert.equal(debits,1);
      return {hunger:body.needs.hunger,quantity,debits,operationId:receipt.operationId};
    } finally { await domains.close(); await host.close(); }
  }
  const baseline = await recover();
  restoreOfflineBackup(planFor(f),pending,join(f.out,'before-pending-restore'));
  const bodyPath = join(f.data,variant === 'legacy' ? 'life/home.json' : 'behavior/home.json');
  assert.equal(read(bodyPath).plannedExecutions[`life:${planId}:eat`].effectAppliedAt > 0,true);
  legacyEconomy(f);
  rmSync(manifest);
  rmSync(join(f.data,CONSOLE_WALLET_IMPORT_FILE));
  await runMigration({installation:f.installation,backup:join(f.out,'migration-backup'),...emptyWalletMigrationInputs(f)});
  assert.deepEqual(await recover(),baseline);
});
