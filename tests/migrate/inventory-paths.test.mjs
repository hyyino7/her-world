import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryPlan } from '../../scripts/migrate/inventory-plan.mjs';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { fileHashes } from '../../scripts/lib/repo-storage.mjs';
import { fixture, planFor } from './helpers.mjs';

test(`current: symlinked temporary parent preserves inventory paths and all source files`, {timeout:60000}, async t => {
  const f = await fixture(t);
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-paths-')));
  t.after(() => rmSync(temporary, {recursive:true, force:true}));
  const physical = join(temporary, 'physical'), alias = join(temporary, 'alias');
  mkdirSync(physical); symlinkSync(physical, alias, 'dir');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = alias;
  t.after(() => { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; });
  assert.notEqual(tmpdir(), realpathSync(tmpdir()), 'Exercise a noncanonical temporary parent on every platform');
  const before = fileHashes(f.out);
  let plan;
  try {
    plan = inventoryPlan(f.installation).plan;
    const report = inventory(f.installation);
    assert.equal(report.roots.length, plan.roots.length);
    assert.equal(new Set(report.roots.map(({id}) => id)).size,plan.roots.length);
    for (const secret of [f.target.id,f.storageId]) assert.ok(!JSON.stringify(report).includes(secret));
    assert.deepEqual(report.differences, {extra:[], missing:[]});
  } finally {
    assert.deepEqual(fileHashes(f.out), before, 'Repo, DSH home, registry and receipt retain every file and byte');
    assert.deepEqual(readdirSync(physical), [], 'Both inventory mirrors are removed');
  }
  // The shared planner opens the source Core; call it only after checking that
  // inventory itself created no source WAL/SHM or other file changes.
  assert.deepEqual(plan, planFor(f), 'Every mirror-derived path maps back to the shared source backup plan');
});
