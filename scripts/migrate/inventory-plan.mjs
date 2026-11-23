// Reuse backupPlan on a private metadata mirror, without touching source databases.
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { backupPlan } from '../lib/offline-backup.mjs';
import { assertStopped, copyDatabase, inspectRepoBinding } from '../lib/repo-storage.mjs';
import { inspectTree, json, readInstallation, regular } from './io.mjs';
import { checked } from './errors.mjs';

const within = (root, path) => path === root || path.startsWith(root + sep);
// Native project path encoding, identical to offline-backup's path convention.
const projectKey = path => '--' + (path.replace(/[\\/:]+/g, '-').split('').map(ch => /^[A-Za-z0-9._-]$/.test(ch)
  ? ch : '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('').replace(/^-+/, '') || 'root').slice(0, 251) + '--';
export function inventoryPlan(installation) {
  const receipt = readInstallation(installation);
  return checked('binding-changed', () => buildInventoryPlan(receipt));
}
function buildInventoryPlan(receipt) {
  inspectTree(receipt.config.dataDir);
  checked('writer-running', () => assertStopped(receipt.config.dataDir, 'core'));
  // Canonicalize before deriving any binding, registry or backup-plan paths.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-binding-')));
  try {
    const initial = join(scratch, 'initial-core');
    const discovered = inspectRepoBinding(receipt.config);
    assert.equal(discovered.state, 'ready');
    const repo = discovered.root, home = dirname(dirname(receipt.profileDir));
    const mirrorRepo = join(scratch, 'repo'), mirrorHome = join(scratch, 'dsh');
    const mappings = [[repo,mirrorRepo],[home,mirrorHome]].sort((a,b) => b[0].length-a[0].length);
    const map = path => {
      assert.ok(isAbsolute(path));
      const pair = mappings.find(([source]) => within(source,path));
      return pair ? join(pair[1],relative(pair[0],path)) : path;
    };
    // Only declarations and identity/binding metadata need bytes. The remaining
    // declared resources are empty regular placeholders, checked by the same API.
    const sourceCore = join(receipt.config.dataDir,'core.sqlite');
    const managed = join(repo,'.chatpet'), manifest = json(join(managed,'manifest.json'));
    inspectTree(managed);
    for (const name of new Set(['README.md','manifest.json','SOUL.md','USER.md','core.json',...manifest.files])) {
      assert.ok(typeof name === 'string' && !isAbsolute(name) && !name.split(/[\\/]/).includes('..'));
      const source = join(managed,name), target = map(source), stat = lstatSync(source);
      if (source === sourceCore) continue; // The binding database is copied below.
      if (stat.isDirectory()) mkdirSync(target,{recursive:true});
      else {mkdirSync(dirname(target),{recursive:true});writeFileSync(target,name === 'manifest.json' ? readFileSync(source) : '');}
    }
    const config = structuredClone(receipt.config);
    const coreInside = within(repo, config.dataDir) || within(home, config.dataDir);
    config.dataDir = coreInside ? map(config.dataDir) : initial;
    copyDatabase(sourceCore,join(config.dataDir,'core.sqlite'));
    const db = new DatabaseSync(join(config.dataDir,'core.sqlite'));
    try {
      for (const kind of ['preferences','workspace-binding']) {
        const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,'current');
        const value = JSON.parse(row.value), target = kind === 'preferences' ? value.workspace : value.target;
        target.path = map(target.path);
        db.prepare('UPDATE records SET value=? WHERE kind=? AND id=?').run(JSON.stringify(value),kind,'current');
      }
    } finally {db.close();}
    if (config.memory) {
      config.memory.dataDir = map(config.memory.dataDir);
      // Validate the real Bank using the shared helper after mapping its selected
      // metadata path. No Bank content is needed for root discovery.
      for (const directory of new Set([join(mirrorRepo,'.chatpet/data/memory'),config.memory.dataDir].filter(path => within(mirrorRepo,path)))) {
        mkdirSync(join(directory,'data'),{recursive:true});
        writeFileSync(join(directory,'data/memory.db'),'x');
      }
    }
    const originalRegistry = json(join(home,'storages/workspace.json'));
    const mirroredRegistry = structuredClone(originalRegistry);
    for (const workspace of Object.values(mirroredRegistry.tables.workspaces)) workspace.path = map(workspace.path);
    const registry = join(mirrorHome,'storages/workspace.json');
    mkdirSync(dirname(registry),{recursive:true}); writeFileSync(registry,JSON.stringify(mirroredRegistry));
    const profileDir = map(receipt.profileDir); mkdirSync(profileDir,{recursive:true});
    const binding = inspectRepoBinding(config);
    const plan = backupPlan({repo:mirrorRepo,workspaceId:binding.target.id,storageId:binding.storageId,profileDir,dshHome:mirrorHome,config});
    const unmap = path => {
      let result = path;
      for (const [id, workspace] of Object.entries(mirroredRegistry.tables.workspaces)) {
        result = result.replace(projectKey(workspace.path),projectKey(originalRegistry.tables.workspaces[id].path));
      }
      const pair = mappings.find(([,target]) => within(target,result));
      if (pair) return join(pair[0],relative(pair[1],result));
      if (within(initial,result)) return join(receipt.config.dataDir,relative(initial,result));
      return result;
    };
    const result = Object.fromEntries(Object.entries(plan).map(([key,value]) => [key,typeof value === 'string' && isAbsolute(value) ? unmap(value) : value]));
    result.roots = plan.roots.map(root => ({...root,path:unmap(root.path)}));
    for (const root of result.roots) inspectTree(root.path);
    // The mirror validates shape; the actual selected Bank must also exist.
    if (result.memoryDirectory) {
      const bank = regular(join(result.memoryDirectory,'data/memory.db'));
      assert.ok(bank?.size > 0, 'Existing Bank required');
    }
    return {plan:result};
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
