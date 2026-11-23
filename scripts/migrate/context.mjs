import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { storageManifestIndex } from '../../dist/src/core/storage-migration.js';
import { backupPlan, assertDshStopped } from '../lib/offline-backup.mjs';
import { inspectRepoBinding, assertStopped } from '../lib/repo-storage.mjs';
import { inspectTree, json, readInstallation, regular } from './io.mjs';
import { checked, requireMigration } from './errors.mjs';
import manifestStep, { storageManifest } from './steps/0001-storage-manifest.mjs';

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

export function assertWalletBrowserOffline(context) {
  assertOffline(context);
  checked('writer-running', () => {
    const managed = join(context.plan.repo,'.chatpet');
    const declared = json(join(managed,'manifest.json')).files;
    const known = new Set([join(managed,'data','memory'), ...declared
      .filter(file => file.endsWith('/data/memory.db')).map(file => join(managed,dirname(dirname(file))))]);
    for (const entry of readdirSync(managed,{recursive:true,withFileTypes:true})) {
      if (entry.name !== 'service.json' || basename(entry.parentPath) !== 'runtime') continue;
      const directory = dirname(entry.parentPath), owner = join(entry.parentPath,entry.name);
      let memory = known.has(directory) || existsSync(join(directory,'data','memory.db'));
      if (!memory && entry.isFile()) {
        try { memory = json(owner)?.token_env === 'DSH_MEMORY_TOKEN'; }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      if (memory) {
        regular(owner);
        assertStopped(directory,'memory');
      }
    }
  });
}
