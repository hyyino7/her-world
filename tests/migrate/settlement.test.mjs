import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCore } from '../../dist/src/core/index.js';
import { PersistentLifePlan } from '../../dist/src/living/plan/plan.js';
import { openDomains } from '../../scripts/fixtures/synthetic-companion.mjs';
import { createOfflineBackup, restoreOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { fixture, mockDsh, planFor, read } from './helpers.mjs';

test('0.5.0 备份恢复后已生效的 Body 动作仍只结算一次', {timeout:60000}, async t => {
  mockDsh(t); const f = await fixture(t);
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const file = join(f.data,'economy/economy.sqlite');
  const sql = text => {const db = new DatabaseSync(file);try {db.exec(text);} finally {db.close();}};
  let host = createCore(f.config), domains = openDomains(host);
  const plan = () => new PersistentLifePlan(join(f.data,'life'),f.config.companionId,f.storageId,'UTC');
  let planId, effect;
  try {
    await domains.body.setAutonomy(f.target.id,true);
    await plan().commit(plan().read().revision,{goal:'fixture meal',reason:'fixture',steps:[{id:'eat',kind:'economy',activity:'fixture',economy:{type:'consume',itemId:'food:improved-meal',quantity:1}}],nextConsiderAt:null});
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
  const bodyPath = join(f.data,'behavior/home.json');
  assert.ok(read(bodyPath).plannedExecutions[`life:${planId}:eat`].effectAppliedAt > 0);
  assert.deepEqual(await recover(),baseline);
});
