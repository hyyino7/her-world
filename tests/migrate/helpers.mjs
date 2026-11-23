import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {content, generateSynthetic, value} from '../../scripts/fixtures/synthetic-companion.mjs';
import {createCore} from '../../dist/src/core/index.js';
import {backupPlan} from '../../scripts/lib/offline-backup.mjs';

export function mockDsh(t, running = false) {
  const original = childProcess.spawnSync;
  const mocked = t.mock.method(childProcess, 'spawnSync', (command, args, options) => command === 'pgrep'
    ? {status:running ? 0 : 1, stdout:running ? String(process.pid + 100000) : '', stderr:''}
    : original(command, args, options));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}
export async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-synthetic-')));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  return generateSynthetic(join(root, 'installed'));
}
export function planFor(f) {
  return backupPlan({repo:f.repo,workspaceId:f.target.id,storageId:f.storageId,profileDir:f.profile,dshHome:f.home,config:f.config});
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
export function inventoryCli(args) {
  return childProcess.spawnSync(process.execPath, [resolve('scripts/migrate/inventory.mjs'), ...args], {encoding:'utf8'});
}
export function refusedInventory(f, args, code) {
  const result = inventoryCli(args);
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  const output = JSON.parse(result.stderr);
  assert.equal(output.code,code);
  assert.equal(typeof output.message,'string');
  for (const secret of [...Object.values(content),f.config.companionId,f.config.scopeId,f.config.ownerActorId,
    f.target.id,f.storageId,f.out,f.repo,f.home,f.installation]) assert.ok(!result.stderr.includes(secret),'Refusal exposes data');
  return output;
}
