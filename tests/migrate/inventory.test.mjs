import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inventoryPlan } from '../../scripts/migrate/inventory-plan.mjs';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { fileHashes } from '../../scripts/lib/repo-storage.mjs';
import { content } from '../../scripts/fixtures/synthetic-companion.mjs';
import { planFor, variants, fixture } from './helpers.mjs';

for (const variant of variants) test(`${variant}: inventory emits metadata and detects discrepancies without source writes`, {timeout:60000}, async t => {
  const f = await fixture(t,variant,{keepStorageManifest:true}), before = fileHashes(f.managed), report = inventory(f.installation);
  const text = JSON.stringify(report);
  for (const secret of [...Object.values(content),f.target.id,f.storageId,f.config.companionId,f.config.scopeId,f.config.ownerActorId,f.repo,f.home,f.config.memory.python]) assert.ok(!text.includes(secret), 'Content or absolute identity escaped');
  assert.ok(report.files.some(file => file.tables?.some(table => table.name === 'records' && table.rows > 0)));
  assert.deepEqual(fileHashes(f.managed),before);
  assert.deepEqual(inventoryPlan(f.installation).plan.roots,planFor(f).roots,'Metadata mirror preserves the shared backup root inventory');
  const db = new DatabaseSync(join(f.config.dataDir,'core.sqlite'));
  db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?)').run('SYNTHETIC_UNKNOWN_KIND_817','fixture','"SYNTHETIC_HIDDEN_VALUE_817"');
  db.close();
  writeFileSync(join(f.managed,'unregistered-file'),'SYNTHETIC_HIDDEN_FILE_817');
  const difference = inventory(f.installation), output = JSON.stringify(difference);
  assert.equal(difference.files.find(file => file.path.endsWith('/core.sqlite')).unknownKinds,1);
  assert.ok(difference.differences.extra.includes('companion/unregistered-file'));
  const recent = new DatabaseSync(join(f.data,'memory/recent-interactions.sqlite'));
  recent.exec('DROP TABLE recent'); recent.close();
  const missing = inventory(f.installation);
  assert.ok(missing.differences.missing.includes('emotion-recent'));
  assert.deepEqual(missing.coverage.find(row => row.id === 'emotion-recent').missingTables,['recent']);
  for (const secret of ['SYNTHETIC_UNKNOWN_KIND_817','SYNTHETIC_HIDDEN_VALUE_817','SYNTHETIC_HIDDEN_FILE_817']) assert.ok(!output.includes(secret));
});

for (const variant of variants) test(`${variant}: inventory follows the selected nondefault Bank with an empty default directory`, {timeout:60000}, async t => {
  const f = await fixture(t,variant,{keepStorageManifest:true}), original = join(f.data,'memory'), selected = join(f.managed,'selected-bank');
  renameSync(original,selected); mkdirSync(original);
  const receipt = JSON.parse(readFileSync(f.installation,'utf8'));
  receipt.config.memory.dataDir = selected;
  writeFileSync(f.installation,JSON.stringify(receipt));
  const manifestFile = join(f.managed,'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile,'utf8'));
  manifest.files = manifest.files.map(name => name.startsWith('data/memory/') ? name.replace('data/memory/','selected-bank/') : name);
  writeFileSync(manifestFile,JSON.stringify(manifest));
  const report = inventory(f.installation);
  assert.equal(report.coverage.find(row => row.id === 'memory').state,'present');
  assert.deepEqual(report.differences.extra,[]);
});
