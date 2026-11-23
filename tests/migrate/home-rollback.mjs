import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineBackup, restoreOfflineBackup, verifyOfflineBackup} from '../../scripts/lib/offline-backup.mjs';
import {inspectRepoBinding} from '../../scripts/lib/repo-storage.mjs';
import {cordisFixture} from '../behavior-list/entries-lifecycle.test.mjs';
import {cli, mockDsh, planFor, read} from './helpers.mjs';
import {selectEconomyCli} from './migration-child.mjs';
import {economyPaths} from './offline-helpers.mjs';

const project = realpathSync(new URL('../..', import.meta.url));
const fromVersion = (root, file) => import(pathToFileURL(join(root, file)).href);

function stagePackage(root, installed) {
  const code = join(installed, 'dist/src');
  rmSync(code, {recursive:true, force:true});
  mkdirSync(dirname(code), {recursive:true});
  cpSync(join(root, 'package.json'), join(installed, 'package.json'));
  cpSync(join(root, 'dist/src'), code, {recursive:true});
}

test('真实 v0.2.0 回退后聊天、召回和共享 home 可用', {timeout:60000}, async t => {
  const archive = process.env.HER_WORLD_020_ROOT;
  assert.ok(archive, 'Set HER_WORLD_020_ROOT to the prepared v0.2.0 checkout with node_modules, .venv and dist');
  const oldRoot = realpathSync(archive);
  assert.equal(read(join(oldRoot, 'package.json')).version, '0.2.0');
  const {generateSynthetic, content} = await fromVersion(oldRoot, 'scripts/fixtures/synthetic-companion.mjs');
  const oldCore = await fromVersion(oldRoot, 'dist/src/core/plugin.js');
  const {createCore} = await fromVersion(oldRoot, 'dist/src/core/index.js');
  const {CompanionEconomy} = await fromVersion(oldRoot, 'dist/src/economy/plugin.js');
  const {resolveCompanionHome} = await fromVersion(oldRoot, 'dist/src/core/companion-foundation.js');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'home-rollback-')));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mockDsh(t);
  selectEconomyCli(t);
  const f = await generateSynthetic(join(root, 'old-installation'));
  const walletSnapshot = async host => {
    const economy = new CompanionEconomy({},host);
    try {
      const {balance,inventory,ledger} = await economy.snapshot(f.target.id);
      return {balance,inventory,ledger};
    } finally { economy.close(); }
  };
  const preUpgrade = createCore(f.config);
  let walletBefore;
  try { walletBefore = await walletSnapshot(preUpgrade); }
  finally { await preUpgrade.close(); }
  const plan = planFor(f), {installedPackage, registryFile} = plan;
  const copies = join(f.config.dataDir, 'native-sessions');
  const transcripts = readdirSync(copies).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(transcripts.length, 1);
  const portable = join(copies, transcripts[0]), savedLog = read(portable);
  // The inventory fixture carries a placeholder event. Seed a valid empty
  // transcript so the old runtime can reopen and append its first native turn.
  const originalLog = JSON.stringify({...savedLog, header:{...savedLog.header, agentPreset:'standard'}, events:[]}) + '\n';
  writeFileSync(portable, originalLog);
  const rollback = join(root, 'rollback'), samePackage = join(root, 'same-package');
  const manifest = join(f.data, 'storage-manifest.json'), life = join(f.data, 'life/life.json');
  const database = join(f.config.dataDir, 'core.sqlite'), originalRegistry = read(registryFile);
  const originalInstallation = readFileSync(f.installation);
  const readBinding = db => db.prepare("SELECT value FROM records WHERE kind='workspace-binding' AND id='current'").get().value;
  const marker = (db,key) => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
  const legacyKey = `economy.initialized:${f.storageId}`;
  const walletPaths = economyPaths(f), identity = {storageId:f.storageId,companionId:f.config.companionId};
  const originalDb = new DatabaseSync(database, {readOnly:true});
  let originalBinding;
  try {
    originalBinding = readBinding(originalDb);
    assert.deepEqual(JSON.parse(marker(originalDb,legacyKey)),{companionId:f.config.companionId,path:f.repo});
  } finally { originalDb.close(); }

  stagePackage(oldRoot, installedPackage);
  createOfflineBackup(plan, rollback);
  const oldFingerprint = verifyOfflineBackup(rollback, plan).codeFingerprint;
  stagePackage(project, installedPackage);
  assert.throws(() => verifyOfflineBackup(rollback, plan), /package/i);
  const migrate = backup => {
    const result = cli(f, ['run','--installation',f.installation,'--backup',backup]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).steps, ['0001-storage-manifest','0002-home-identity','0003-economy-marker']
      .map(id => ({id,state:'complete'})));
  };
  migrate(samePackage);
  const newFingerprint = verifyOfflineBackup(samePackage, plan).codeFingerprint;
  assert.notEqual(newFingerprint, oldFingerprint);
  assert.equal(restoreOfflineBackup(plan, samePackage, join(root, 'before-retry')).restored, true);
  assert.equal(existsSync(manifest), false);
  migrate(join(root, 'retry'));
  assert.equal(existsSync(manifest), true);
  assert.deepEqual([read(manifest).modules.core,read(manifest).modules.living],[3,3]);
  assert.deepEqual(read(walletPaths.adoption),identity);
  {
    using core = new DatabaseSync(database,{readOnly:true});
    using wallet = new DatabaseSync(walletPaths.database,{readOnly:true});
    assert.equal(marker(core,legacyKey),undefined);
    assert.deepEqual(JSON.parse(marker(wallet,'economy.initialized')),identity);
  }

  const irreversible = [['life-outlet-delivery','synthetic-delivery'], ['channel-usage-event','synthetic-quota']];
  const upgraded = new DatabaseSync(database);
  try {
    upgraded.prepare("UPDATE records SET value=? WHERE kind='workspace-binding' AND id='current'")
      .run(JSON.stringify({...JSON.parse(originalBinding), revision:999}));
    const insert = upgraded.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?)');
    for (const row of irreversible) insert.run(...row, 'true');
  } finally { upgraded.close(); }
  const spend = {day:'2026-01-02', yuan:4};
  writeFileSync(life, JSON.stringify({...read(life), homeSessionId:'newer-mirror', spend}));

  stagePackage(oldRoot, installedPackage);
  assert.throws(() => verifyOfflineBackup(samePackage, plan), /package/i);
  assert.equal(verifyOfflineBackup(rollback, plan).codeFingerprint, oldFingerprint);
  const restored = restoreOfflineBackup(plan, rollback, join(root, 'before-rollback'));
  assert.equal(restored.restored, true);
  assert.equal(existsSync(manifest), false);
  assert.equal(existsSync(join(f.data, 'migrations.jsonl')), false);
  assert.equal(existsSync(walletPaths.adoption),false);
  {
    using wallet = new DatabaseSync(walletPaths.database,{readOnly:true});
    assert.equal(marker(wallet,'economy.initialized'),undefined);
  }
  assert.deepEqual(readFileSync(f.installation), originalInstallation);
  assert.deepEqual(read(registryFile), originalRegistry);
  assert.equal(readFileSync(portable, 'utf8'), originalLog);
  assert.equal(inspectRepoBinding(f.config).storageId, f.storageId);
  assert.deepEqual(read(life).spend, spend);
  const reopened = new DatabaseSync(database, {readOnly:true});
  try {
    assert.equal(readBinding(reopened), originalBinding);
    assert.deepEqual(JSON.parse(marker(reopened,legacyKey)),{companionId:f.config.companionId,path:f.repo});
    const row = reopened.prepare('SELECT value FROM records WHERE kind=? AND id=?');
    for (const key of irreversible) assert.equal(row.get(...key)?.value, 'true');
    assert.equal(row.get('companion-home', f.storageId), undefined);
  } finally { reopened.close(); }

  const native = read(registryFile);
  const registry = {workspaces:Object.entries(native.tables.workspaces).map(([id, value]) => ({id,...value})),
    archived:native.global.archivedSessionIds};
  const running = await cordisFixture(t, {order:[], existing:{...f, corePlugin:oldCore, registry}});
  try {
    assert.equal(running.core.workspace.status().state, 'ready');
    assert.deepEqual(await walletSnapshot(running.core),walletBefore);
    const home = await resolveCompanionHome(running.ctx, running.core);
    assert.equal(home.id, 'fixture-session');
    assert.deepEqual(running.sessionCreateCalls, []);
    const turn = await running.input('Synthetic chat after rollback.', home.id);
    assert.equal(turn.agent, home);
    assert.ok(turn.system.includes(content.character));
    const reply = home.session.snapshotEvents().findLast(event => event.type === 'assistant/message');
    assert.equal(reply.data.message.content[0].text, 'Synthetic reply');
    const bank = running.core.native.memory;
    assert.ok((await bank.findForOwner(f.target.id, content.memory)).items.some(row => row.id === f.memoryId));
    assert.ok(!(await bank.findForOwner(f.target.id, content.withdrawn)).items.some(row => row.id === f.withdrawnId));
  } finally { await running.stop(); }
});
