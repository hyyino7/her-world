import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, readFileSync, renameSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inventory } from '../../scripts/migrate/inventory.mjs';
import { offlineFixture } from './offline-helpers.mjs';
import { cli, planFor, read, refusedCli } from './helpers.mjs';

test('inventory metadata: public roots omit workspace and storage identifiers',async t => {
  const f = await offlineFixture(t), result = cli(f,['--installation',f.installation],{inventory:true});
  assert.equal(result.status,0);
  for (const secret of [f.target.id,f.storageId,f.config.companionId,f.out]) assert.ok(!result.stdout.includes(secret));
  const report = JSON.parse(result.stdout);
  assert.ok(report.roots.some(row => row.id === 'sessions-1'));
  assert.ok(report.roots.some(row => row.id === 'cache-1'));
});
test('inventory metadata: selected nondefault Bank maps into the Memory registry',async t => {
  const f = await offlineFixture(t), selected = join(f.managed,'selected-bank');
  renameSync(join(f.data,'memory'),selected); mkdirSync(join(f.data,'memory'));
  const receipt = read(f.installation); receipt.config.memory.dataDir = selected;
  writeFileSync(f.installation,JSON.stringify(receipt));
  // The synthetic offline layout declares the actual Bank and recent ledger.
  const manifestFile = join(f.managed,'manifest.json'), manifest = read(manifestFile);
  manifest.files = manifest.files.map(name => name.startsWith('data/memory/') ? name.replace('data/memory/','selected-bank/') : name);
  writeFileSync(manifestFile,JSON.stringify(manifest));
  const report = inventory(f.installation);
  assert.equal(report.coverage.find(row => row.id === 'memory').state,'present');
  assert.equal(report.coverage.find(row => row.id === 'emotion-recent').state,'present');
  assert.deepEqual(report.differences.extra,[]);
});
test('inventory metadata: empty default Memory directory cannot claim coverage',async t => {
  const f = await offlineFixture(t,false);
  // No Bank has been enabled; retain the default directory, remove only the
  // synthetic recent ledger and its declaration so that the layout stays ready.
  rmSync(join(f.data,'memory/recent-interactions.sqlite'));
  const file = join(f.managed,'manifest.json'), manifest = read(file);
  manifest.files = manifest.files.filter(name => name !== 'data/memory/recent-interactions.sqlite');
  writeFileSync(file,JSON.stringify(manifest));
  const report = inventory(f.installation);
  assert.equal(report.coverage.find(row => row.id === 'memory').state,'missing');
  assert.ok(report.differences.missing.includes('memory'));
});
test('inventory metadata: empty voice directory still has coverage',async t => {
  const f = await offlineFixture(t,false), directory = planFor(f).roots.find(root => root.id === 'voice').path;
  mkdirSync(directory,{recursive:true});
  assert.deepEqual(readdirSync(directory),[]);
  const report = inventory(f.installation);
  assert.equal(report.coverage.find(row => row.id === 'voice').state,'present');
  assert.ok(!report.differences.missing.includes('voice'));
});
test('inventory metadata: recent ledger cannot replace the Memory container file',async t => {
  const f = await offlineFixture(t,false), report = inventory(f.installation);
  assert.equal(report.coverage.find(row => row.id === 'emotion-recent').state,'present');
  assert.equal(report.coverage.find(row => row.id === 'memory').state,'missing');
  assert.ok(report.differences.missing.includes('memory'));
});
test('inventory metadata: concrete containers require a file at either registered location',async t => {
  const f = await offlineFixture(t,false);
  const containers = ['behavior','life'].map(directory => join(f.data,directory,'home.json'));
  for (const file of containers) mkdirSync(file);
  assert.equal(inventory(f.installation).coverage.find(row => row.id === 'body').state,'missing');
  for (const file of containers) {
    rmSync(file,{recursive:true}); writeFileSync(file,'{}');
    assert.equal(inventory(f.installation).coverage.find(row => row.id === 'body').state,'present');
    rmSync(file); mkdirSync(file);
  }
});

test('inventory 拒绝无效回执和链接并保留源文件',async t => {
  const f = await offlineFixture(t,false,{keepStorageManifest:true});
  const args = ['--installation',f.installation], options = {inventory:true};
  const receipt = readFileSync(f.installation);
  refusedCli(f,[],'usage',options);
  writeFileSync(f.installation,'{');
  refusedCli(f,args,'receipt-invalid',options);
  writeFileSync(f.installation,receipt);
  const original = join(f.managed,'SOUL.md'), bytes = readFileSync(original);
  for (const [makeLink,code] of [[symlinkSync,'symlink-or-hardlink'],[linkSync,'binding-changed']]) {
    const link = join(f.data,'inventory-link');
    makeLink(original,link);
    try {refusedCli(f,args,code,options);}
    finally {rmSync(link);}
    assert.deepEqual(readFileSync(original),bytes);
  }
});
