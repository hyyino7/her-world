import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { variants, fixture, coreAtLegacyVersion, coreReady, recall, mockDsh, emptyWalletMigrationInputs } from './helpers.mjs';
import { runMigration } from '../../scripts/migrate/runner.mjs';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { storage } from '../../scripts/migrate/context.mjs';
import { bootstrapSteps } from './migration-child.mjs';

for (const variant of variants) test(`${variant}: registry coverage and old Core compatibility before/after metadata`, {timeout:60000}, async t => {
  mockDsh(t); const f = await fixture(t,variant);
  const old = variant === 'legacy';
  for (const name of ['self.md','diary','self.history']) {
    assert.equal(existsSync(join(f.managed,name)),!old);
    assert.equal(existsSync(join(f.data,'life',name)),old);
  }
  assert.equal(existsSync(join(f.data,'behavior/home.json')),!old);
  assert.equal(existsSync(join(f.data,'life/home.json')),old);
  assert.equal(existsSync(join(f.data,'core/photos/album.sqlite')),!old);
  assert.equal(existsSync(join(f.data,'life/photos/album.sqlite')),old);
  const report = inventory(f.installation);
  assert.deepEqual(report.coverage.map(row => row.id),storage.entries.map(row => row.id));
  assert.deepEqual(report.differences,{extra:[],missing:['console-wallet-import-proof','economy-adoption']});
  assert.equal(report.coverage.filter(row => row.state === 'browser-check-required').length,2);
  await coreAtLegacyVersion(f);
  const identityManifest = readFileSync(join(f.managed,'manifest.json'));
  await runMigration({installation:f.installation,backup:join(f.out,'backup')},bootstrapSteps);
  await runMigration({installation:f.installation,backup:join(f.out,'home-backup'),...emptyWalletMigrationInputs(f)});
  assert.deepEqual(inventory(f.installation).differences,{extra:[],missing:['console-wallet-import-proof']});
  await coreReady(f); await recall(f);
  assert.deepEqual(readFileSync(join(f.managed,'manifest.json')),identityManifest);
});
