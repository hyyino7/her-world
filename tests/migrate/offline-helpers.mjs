// Metadata-only fixtures use real offline initializers. They do not implement
// or substitute a Memory provider; recall exercises use the full fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createCore } from '../../dist/src/core/index.js';
import { CONSOLE_WALLET_IMPORT_FILE } from '../../dist/src/core/storage-migration.js';
import { value } from '../../scripts/fixtures/synthetic-companion.mjs';
import { backupPlan } from '../../scripts/lib/offline-backup.mjs';

export const economyPaths = f => ({database:join(f.data, 'economy/economy.sqlite'),
  adoption:join(f.data, 'living/economy-adoption.json')});

export async function offlineFixture(t, memory = true, {legacyStorage = false} = {}) {
  const out = realpathSync(mkdtempSync(join(tmpdir(),'migration-metadata-')));
  t.after(() => rmSync(out,{recursive:true,force:true}));
  const repo = join(out,'repo'), home = join(out,'dsh'), profile = join(home,'profiles','fixture');
  const managed = join(repo,'.chatpet'), data = join(managed,'data'); mkdirSync(repo);
  mkdirSync(join(data,'economy'),{recursive:true});
  const config = {companionId:'synthetic-companion-817',scopeId:'synthetic-scope-817',ownerActorId:'synthetic-owner-817',displayName:'fixture',character:'SYNTHETIC_CHARACTER_817',dataDir:join(data,'core'),
    ...(memory ? {memory:{python:resolve('.venv/bin/python'),dataDir:join(data,'memory')}} : {})};
  const target = {id:'synthetic-workspace-817',path:repo,title:'fixture'}, host = createCore(config);
  let storageId;
  try {
    const request = () => host.operator.request('metadata-fixture');
    const before = value(await host.services.preferences.read(request(),{}));
    const prefs = value(await host.services.preferences.save(request(),{expectedRevision:before.revision,workspace:target,conversation:before.conversation}));
    assert.equal(value(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:prefs.revision})).state,'ready');
    storageId = host.workspace.storageId();
  } finally {await host.close();}
  if (legacyStorage) {
    rmSync(join(data, 'storage-manifest.json'));
    rmSync(join(data, CONSOLE_WALLET_IMPORT_FILE),{force:true});
  }
  const write = (file,text) => {mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  write(join(profile,'node_modules/her-world/package.json'),JSON.stringify({name:'her-world',version:'0.5.0',synthetic:true}));
  write(join(profile,'cordis.patch.yml'),'# Synthetic metadata fixture\n');
  write(join(home,'storages/workspace.json'),JSON.stringify({unit:{name:'workspace',version:1},
    global:{workspaceIds:[target.id],archivedSessionIds:[],pinnedSessionIds:[],defaultWorkspaceId:target.id},
    tables:{workspaces:{[target.id]:{path:repo,title:'fixture',sessionIds:['fixture-session']}}}}));
  const plan = backupPlan({repo,workspaceId:target.id,storageId,profileDir:profile,dshHome:home,config});
  for (const root of plan.roots.filter(row => row.id.startsWith('sessions-'))) write(join(root.path,'fixture-session/session.v4.jsonl.zstd'),'SYNTHETIC_NATIVE_LOG_817');
  write(join(plan.cacheDirectory,'fixture-session.json'),'{}');
  const installation = join(out,'installation.json');
  write(installation,JSON.stringify({status:'installed',packageInstalled:true,profileDir:profile,config}));
  return {out,repo,home,profile,managed,data,config,target,installation,storageId};
}
