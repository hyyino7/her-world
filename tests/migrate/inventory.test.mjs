import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inventoryPlan } from '../../scripts/migrate/inventory-plan.mjs';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { fileHashes } from '../../scripts/lib/repo-storage.mjs';
import { content } from '../../scripts/fixtures/synthetic-companion.mjs';
import { appendUsage, usageDay } from '../../dist/src/core/usage/ledger.js';
import { planFor, fixture } from './helpers.mjs';

test(`current: inventory emits metadata and detects discrepancies without source writes`, {timeout:60000}, async t => {
  const f = await fixture(t), before = fileHashes(f.managed), report = inventory(f.installation);
  const text = JSON.stringify(report);
  for (const secret of [...Object.values(content),f.target.id,f.storageId,f.config.companionId,f.config.scopeId,f.config.ownerActorId,f.repo,f.home,f.config.memory.python]) assert.ok(!text.includes(secret), 'Content or absolute identity escaped');
  assert.ok(report.files.some(file => file.tables?.some(table => table.name === 'records' && table.rows > 0)));
  assert.deepEqual(fileHashes(f.managed),before);
  assert.deepEqual(inventoryPlan(f.installation).plan.roots,planFor(f).roots,'Metadata mirror preserves the shared backup root inventory');
  assert.equal(report.coverage.find(row => row.id === 'usage-ledger').state,'not-created');
  mkdirSync(join(f.data,'usage'));
  const ledger = new DatabaseSync(join(f.data,'usage/ledger.sqlite'));
  ledger.exec('CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)'); ledger.close();
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
  assert.ok(missing.differences.missing.includes('usage-ledger'));
  assert.deepEqual(missing.coverage.find(row => row.id === 'usage-ledger').missingTables,['calls']);
  assert.ok(missing.differences.missing.includes('emotion-recent'));
  assert.deepEqual(missing.coverage.find(row => row.id === 'emotion-recent').missingTables,['recent']);
  for (const secret of ['SYNTHETIC_UNKNOWN_KIND_817','SYNTHETIC_HIDDEN_VALUE_817','SYNTHETIC_HIDDEN_FILE_817']) assert.ok(!output.includes(secret));
});

test(`current: inventory follows the selected nondefault Bank with an empty default directory`, {timeout:60000}, async t => {
  const f = await fixture(t), original = join(f.data,'memory'), selected = join(f.managed,'selected-bank');
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

test('坏账本恢复后，盘点只读新库的表，原库及旁文件留档均已登记', {timeout:60000}, async t => {
  const f = await fixture(t), directory = join(f.data,'usage'), path = join(directory,'ledger.sqlite');
  mkdirSync(directory);
  writeFileSync(path,'synthetic damaged ledger');
  writeFileSync(path+'-shm','synthetic sidecar');
  const at = Date.now();
  appendUsage(f.repo,{started_at:at, ended_at:at, day:usageDay(at), session_id:null,
    entry:'dsh', preset:'standard', purpose:null, provider:'fixture', model:'fixture', requested_effort:null,
    outcome:'completed', input_miss:null, output:null, cache_read:null, cache_write:null, reasoning:null});
  const report = inventory(f.installation);
  assert.deepEqual(report.differences,{missing:[],extra:[]});
  const archives = report.files.filter(file => file.path.includes('ledger.sqlite.corrupt-'));
  assert.equal(archives.length,2);
  assert.ok(archives.every(file => !('tables' in file)));
  const coverage = report.coverage.find(row => row.id === 'usage-ledger');
  assert.ok(archives.every(file => coverage.paths.includes(file.path)));
  const live = report.files.find(file => file.path.endsWith('/ledger.sqlite'));
  assert.equal(live.tables.find(table => table.name === 'calls').rows,1);
});
