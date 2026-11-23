import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture, coreReady, recall} from './helpers.mjs';
import {inventory, storage} from '../../scripts/migrate/inventory.mjs';

test('0.5.0 保留当前盘点、身份和记忆召回', {timeout:60000}, async t => {
  const f = await fixture(t);
  for (const name of ['self.md','diary','self.history']) assert.ok(existsSync(join(f.managed,name)));
  for (const name of ['behavior/home.json','core/photos/album.sqlite']) assert.ok(existsSync(join(f.data,name)));
  const report = inventory(f.installation);
  assert.deepEqual(report.coverage.map(row => row.id),storage.entries.map(row => row.id));
  assert.deepEqual(report.differences,{extra:[],missing:[]});
  assert.deepEqual(report.coverage.filter(row => row.state === 'browser-check-required').map(row => row.id),['room-home']);
  const manifest = join(f.managed,'manifest.json'), identity = readFileSync(manifest);
  await coreReady(f); await recall(f);
  assert.deepEqual(readFileSync(manifest),identity);
});
