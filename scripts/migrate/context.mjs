import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { storageManifestIndex } from '../../dist/src/core/storage-migration.js';
import { backupPlan, assertDshStopped } from '../lib/offline-backup.mjs';
import { inspectRepoBinding, assertStopped } from '../lib/repo-storage.mjs';
import { inspectTree, json, regular } from './io.mjs';
import { checked, requireMigration } from './errors.mjs';
import manifestStep, { storageManifest } from './steps/0001-storage-manifest.mjs';

export const storage = json(new URL('../../arch/storage.json', import.meta.url));
export function loadInstallation(file) {
  const receipt = readInstallation(file);
  inspectTree(receipt.config.dataDir);
  checked('writer-running', () => assertStopped(receipt.config.dataDir, 'core'));
  const binding = checked('binding-changed', () => inspectRepoBinding(receipt.config));
  requireMigration(binding.state === 'ready', 'binding-changed');
  const plan = checked('binding-changed', () => backupPlan({repo:binding.root, workspaceId:binding.target.id, storageId:binding.storageId,
    profileDir:receipt.profileDir, dshHome:dirname(dirname(receipt.profileDir)), config:receipt.config}));
  for (const root of plan.roots) inspectTree(root.path);
  const data = join(plan.repo, '.chatpet', 'data');
  return {receipt, plan, data, manifestFile:join(data, 'storage-manifest.json'),
    journalFile:join(data, 'migrations.jsonl'), lockFile:join(data, 'migration.lock')};
}
export function expectedManifest(context) {
  return storageManifest(context, manifestStep.to);
}

export function manifestVersion(context, contract) {
  if (!regular(context.manifestFile)) return 0;
  const manifest = checked('manifest-mismatch', () => json(context.manifestFile));
  const index = storageManifestIndex(manifest, context.plan.companionId, contract);
  requireMigration(index >= 0, 'manifest-mismatch');
  return index + 1;
}
export function assertOffline(context) {
  checked('dsh-running', () => assertDshStopped(context.plan));
  checked('writer-running', () => assertStopped(context.plan.coreDirectory, 'core'));
  checked('writer-running', () => assertStopped(join(context.data, 'economy'), 'economy'));
  if (context.plan.memoryDirectory) checked('writer-running', () => assertStopped(context.plan.memoryDirectory, 'memory'));
  checked('binding-changed', () => {
    const binding = inspectRepoBinding(context.receipt.config);
    assert.equal(binding.state, 'ready');
    assert.equal(binding.storageId, context.plan.storageId, 'Storage binding changed');
    assert.equal(binding.target.id, context.plan.workspaceId, 'Workspace binding changed');
    assert.equal(binding.root, context.plan.repo, 'Repo binding changed');
  });
}

export function readInstallation(file) {
  return checked('receipt-invalid', () => {
    regular(file); const receipt = json(file);
    requireMigration(receipt?.status === 'installed' && receipt.packageInstalled === true &&
      typeof receipt.config?.dataDir === 'string' && receipt.config.dataDir.length > 0 &&
      typeof receipt.profileDir === 'string' && receipt.profileDir.length > 0, 'receipt-invalid');
    return receipt;
  });
}
