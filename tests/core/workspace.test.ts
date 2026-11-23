import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync, rmSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import { createCore, type CoreConfig } from '../../src/core/index.js';
import { CONSOLE_WALLET_IMPORT_FILE, CONSOLE_WALLET_STEP, ECONOMY_STORAGE_STEP, freshWalletImportProof, HOME_STORAGE_STEP,
  INITIAL_STORAGE_STEP, storageManifest } from '../../src/core/storage-migration.js';
import type { Result } from '../../src/contracts/common.js';
const unwrap = <T>(result: Result<T>): T => { if (!result.ok) assert.fail(JSON.stringify(result.error)); return result.value; };
const fixture = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chatpet-workspace-'))); const repo = join(root, 'repo'); mkdirSync(repo);
  // Core's real schema must live in the complete bound workspace before
  // initialization can advertise it in the portable inventory.
  const config: CoreConfig = { dataDir: join(repo, '.chatpet/data/core'), companionId: 'fixture-companion', scopeId: 'fixture-scope', ownerActorId: 'owner', displayName: 'Example', character: 'A configured character.' };
  return { root, repo, config };
};

test('new workspaces are initialized with the current storage version', async () => {
  const f = fixture();
  mkdirSync(join(f.repo,'.chatpet','diary'),{recursive:true});
  const host = createCore(f.config);
  const request = () => host.operator.request('new-workspace');
  try {
    const prefs = unwrap(await host.services.preferences.read(request(), {}));
    const bound = unwrap(await host.services.preferences.save(request(), {expectedRevision:prefs.revision, conversation:prefs.conversation,
      workspace:{id:'repo', path:f.repo, title:'Repo'}}));
    assert.equal(host.workspace.status().state, 'pending');
    const initialized = unwrap(await host.services.workspace.initialize(request(), {expectedPreferencesRevision:bound.revision}));
    assert.equal(initialized.state, 'ready');
    assert.deepEqual(JSON.parse(readFileSync(join(f.repo, '.chatpet/data/storage-manifest.json'), 'utf8')),
      storageManifest(f.config.companionId, CONSOLE_WALLET_STEP.to));
    assert.deepEqual(JSON.parse(readFileSync(join(f.repo,'.chatpet/data',CONSOLE_WALLET_IMPORT_FILE),'utf8')),
      freshWalletImportProof({companionId:f.config.companionId,storageId:host.workspace.storageId()}));
  } finally { await host.close(); rmSync(f.root, {recursive:true, force:true}); }
});

for (const state of ['absent', '0001', '0002', '0003', 'foreign', 'unfinished', 'wallet-proof-absent']) test(`workspace migration gate: ${state}`, async () => {
  const f = fixture(); let host = createCore(f.config);
  const request = () => host.operator.request('migration-gate');
  const target = {id:'repo', path:f.repo, title:'Repo'};
  const manifest = join(f.repo, '.chatpet/data/storage-manifest.json'), journal = join(f.repo, '.chatpet/data/migrations.jsonl');
  const current = JSON.stringify(storageManifest(f.config.companionId, CONSOLE_WALLET_STEP.to));
  const proof = join(f.repo,'.chatpet/data',CONSOLE_WALLET_IMPORT_FILE);
  try {
    const prefs = unwrap(await host.services.preferences.read(request(), {}));
    const bound = unwrap(await host.services.preferences.save(request(), {expectedRevision:prefs.revision, workspace:target, conversation:prefs.conversation}));
    unwrap(await host.services.workspace.initialize(request(), {expectedPreferencesRevision:bound.revision}));
    await host.close();
    if (state === 'absent') rmSync(manifest, {force:true});
    else writeFileSync(manifest, state === '0001' ? JSON.stringify(storageManifest(f.config.companionId, INITIAL_STORAGE_STEP.to))
      : state === '0002' ? JSON.stringify(storageManifest(f.config.companionId, HOME_STORAGE_STEP.to))
      : state === '0003' ? JSON.stringify(storageManifest(f.config.companionId, ECONOMY_STORAGE_STEP.to))
      : state === 'foreign' ? JSON.stringify(storageManifest('other-companion', CONSOLE_WALLET_STEP.to)) : current);
    const savedProof = readFileSync(proof);
    if (state === 'wallet-proof-absent') rmSync(proof);
    if (state === 'unfinished') writeFileSync(journal, JSON.stringify({event:'migration', id:'unfinished', schema:2,
      backup:f.root, backupHash:'0'.repeat(64), binding:{storageId:target.id,repoHash:createHash('sha256').update(f.repo).digest('hex')},
      steps:[INITIAL_STORAGE_STEP, HOME_STORAGE_STEP]}) + '\n');
    host = createCore(f.config);
    const actual = unwrap(await host.services.workspace.inspect(request(), {}));
    assert.equal(actual.state, 'migration-required');
    assert.equal(actual.migrationReason, state === 'foreign' ? 'manifest-mismatch' : (state === 'unfinished' || state === 'wallet-proof-absent')
      ? 'migration-incomplete' : 'storage-version-outdated');
    const store = host.workspace.runtime.store;
    const before = store.db.prepare('SELECT * FROM requests').all();
    const assertRefused = (result: Result<unknown>) => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'migration-required');
    };
    assertRefused(await host.services.workspace.initialize(request(), {expectedPreferencesRevision:bound.revision}));
    assertRefused(await host.services.preferences.save(request(), {expectedRevision:bound.revision, workspace:null, conversation:bound.conversation}));
    assertRefused(await host.services.preferences.setQuiet(request(), {expectedRevision:1, quiet:true}));
    assert.deepEqual(store.db.prepare('SELECT * FROM requests').all(), before);
    writeFileSync(manifest, current); rmSync(journal, {force:true});
    if (state === 'wallet-proof-absent') writeFileSync(proof,savedProof,{mode:0o600});
    assert.equal(host.workspace.status().state, 'migration-required', 'Only restart lifts the migration gate');
    await host.close(); host = createCore(f.config);
    assert.equal(host.workspace.status().state, 'ready');
  } finally { await host.close(); rmSync(f.root, {recursive:true, force:true}); }
});

test('only an initialized companion Repo gets native-discoverable instructions, and owner edits survive restart', async () => {
  const f = fixture(); let host = createCore(f.config);
  try {
    const prefs = unwrap(await host.services.preferences.read(host.operator.request('instructions.read'), {}));
    assert.ok(!readdirSync(f.repo).includes('AGENTS.md'));
    const saved = unwrap(await host.services.preferences.save(host.operator.request('instructions.bind'), {
      expectedRevision: prefs.revision, conversation: prefs.conversation, workspace: { id: 'repo', path: f.repo, title: 'Repo' },
    }));
    unwrap(await host.services.workspace.initialize(host.operator.request('instructions.initialize'), { expectedPreferencesRevision: saved.revision }));
    const instructions = readFileSync(join(f.repo, 'AGENTS.md'), 'utf8');
    for (const resource of ['.chatpet/', 'SOUL.md', 'USER.md', 'COMPANION.md', 'manifest.json']) assert.ok(instructions.includes(resource));
    assert.ok(instructions.includes('Use registered memory capabilities'));
    assert.ok(instructions.includes('do not create a parallel MEMORY.md or revive STATE.md'));
    assert.ok(!instructions.includes(f.config.character!), 'Navigation instructions must not become another persona source');
    writeFileSync(join(f.repo, 'AGENTS.md'), '# Owner instructions\n');
    await host.close(); host = createCore(f.config);
    unwrap(await host.services.workspace.initialize(host.operator.request('instructions.restart'), { expectedPreferencesRevision: saved.revision }));
    assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), '# Owner instructions\n');
  } finally { await host.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('workspace initialization preserves files, prepares the declared inventory and retains authority after restart and relocation', async () => {
  const f = fixture(); let host = createCore(f.config); let request = 0;
  const context = () => host.operator.request(`workspace-${++request}`);
  try {
    writeFileSync(join(f.repo, 'AGENTS.md'), '# Existing instructions\n'); writeFileSync(join(f.repo, 'README.md'), '# Existing project\n');
    const original = unwrap(await host.services.preferences.read(context(), {}));
    const prefs = unwrap(await host.services.preferences.save(context(), { expectedRevision: original.revision, workspace: { id: 'repo', path: f.repo, title: 'Repo' }, conversation: { ...original.conversation } }));
    assert.equal(unwrap(await host.services.workspace.inspect(context(), {})).state, 'pending');
    const initialized = unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: prefs.revision }));
    assert.equal(initialized.state, 'ready');
    for (const resource of ['README.md', 'manifest.json', 'SOUL.md', 'USER.md', 'COMPANION.md', 'core.json', 'self.md',
      'self.history/', 'diary/', 'data/core/core.sqlite', 'data/core/native-sessions/', 'data/core/photos/album.sqlite',
      'data/memory/recent-interactions.sqlite', 'data/life/control.json', 'data/emotion/state.json', 'data/pet-platform/main-config.jsonc']) {
      assert.ok(initialized.files.includes(resource), `The initialized manifest declares ${resource}`);
      assert.ok(existsSync(join(f.repo, '.chatpet', resource)), `The declared ${resource} actually exists`);
    }
    for (const database of ['data/core/core.sqlite', 'data/core/photos/album.sqlite', 'data/memory/recent-interactions.sqlite']) {
      assert.ok(statSync(join(f.repo, '.chatpet', database)).size > 0, 'A declared database is not an empty placeholder');
      assert.equal(readFileSync(join(f.repo, '.chatpet', database)).subarray(0, 16).toString(), 'SQLite format 3\0');
    }
    assert.equal(JSON.parse(readFileSync(join(f.repo, '.chatpet/manifest.json'), 'utf8')).schemaVersion, 3);
    assert.equal(JSON.parse(readFileSync(join(f.repo, '.chatpet/data/life/control.json'), 'utf8')).enabled, false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.repo, '.chatpet/data/pet-platform/main-config.jsonc'), 'utf8')), {pets: []});
    assert.equal(readFileSync(join(f.repo, '.chatpet/self.md'), 'utf8'), '');
    assert.deepEqual(readdirSync(join(f.repo, '.chatpet/diary')), []);
    assert.equal(host.workspace.storageStatus().core.current, f.config.dataDir);
    assert.equal(host.workspace.storageStatus().complete, true, 'Core-only configuration has portable actual storage');
    const before = readFileSync(join(f.repo, '.chatpet/SOUL.md'), 'utf8');
    const identityBefore = unwrap(await host.services.core.getIdentity(context(), {}));
    const again = unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: prefs.revision }));
    assert.equal(again.state, 'ready'); assert.deepEqual(again.files, initialized.files);
    assert.equal(again.sourceRevision, initialized.sourceRevision);
    assert.equal(readFileSync(join(f.repo, '.chatpet/SOUL.md'), 'utf8'), before);
    assert.equal(unwrap(await host.services.core.getIdentity(context(), {})).companionId, identityBefore.companionId);
    const identity = unwrap(await host.services.core.getIdentity(context(), {}));
    unwrap(await host.services.core.reviseIdentity(context(), { expectedScope:host.workspace.editScope(),expectedRevision: identity.revision, displayName: 'UI name', character: 'UI character' }));
    assert.equal(readFileSync(join(f.repo, '.chatpet/SOUL.md'), 'utf8'), '# UI name\n\nUI character');
    writeFileSync(join(f.repo, '.chatpet/SOUL.md'), '# File name\n\nA manually edited character.');
    const changed = unwrap(await host.services.core.getIdentity(context(), {}));
    assert.equal(changed.displayName, 'File name');
    const stale = await host.services.core.reviseIdentity(context(), { expectedScope:host.workspace.editScope(),expectedRevision: identity.revision, displayName: 'Stale', character: 'Stale' });
    assert.equal(stale.ok, false);
    const user = unwrap(await host.services.workspace.readProfile(context(), {}));
    unwrap(await host.services.workspace.saveProfile(context(), { expectedScope:host.workspace.editScope(),expectedRevision: user.revision, text: '# User\n\nLanguage: Chinese.' }));
    const p = unwrap(await host.services.preferences.read(context(), {}));
    unwrap(await host.services.preferences.save(context(), { expectedRevision: p.revision, workspace: p.workspace, conversation: { ...p.conversation, maxSteps: 5 } }));
    const config = JSON.parse(readFileSync(join(f.repo, '.chatpet/core.json'), 'utf8')); config.quiet = true; config.conversation.maxSteps = 6;
    writeFileSync(join(f.repo, '.chatpet/core.json'), JSON.stringify(config));
    assert.equal(unwrap(await host.services.core.getPolicy(context(), {})).quiet, true);
    assert.equal(unwrap(await host.services.preferences.read(context(), {})).conversation.maxSteps, 6);
    await host.close(); host = createCore(f.config);
    assert.equal(unwrap(await host.services.core.getIdentity(context(), {})).displayName, 'File name');
    assert.equal(unwrap(await host.services.workspace.readProfile(context(), {})).text, '# User\n\nLanguage: Chinese.');
    assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), '# Existing instructions\n');
    assert.equal(readFileSync(join(f.repo, 'README.md'), 'utf8'), '# Existing project\n');
    assert.ok(!readFileSync(join(f.repo, '.chatpet/manifest.json'), 'utf8').includes(f.root));
    const storageId = host.workspace.storageId();
    await host.close();
    const relocated = join(f.root, 'relocated-repo'); cpSync(f.repo, relocated, {recursive: true});
    host = createCore({...f.config, dataDir: join(relocated, '.chatpet/data/core')});
    const relocatedPrefs = unwrap(await host.services.preferences.read(context(), {}));
    const rebound = unwrap(await host.services.preferences.save(context(), {expectedRevision: relocatedPrefs.revision,
      workspace: {id: 'new-native-workspace', path: relocated, title: 'Relocated Repo'}, conversation: relocatedPrefs.conversation}));
    assert.equal(unwrap(await host.services.workspace.initialize(context(), {expectedPreferencesRevision: rebound.revision})).state, 'ready');
    assert.equal(host.workspace.storageId(), storageId, 'A native workspace ID/path change retains portable storage identity');
    assert.equal(host.workspace.storageStatus().core.current, join(relocated, '.chatpet/data/core'));
    assert.equal(host.workspace.storageStatus().complete, true);
    assert.equal(unwrap(await host.services.core.getIdentity(context(), {})).companionId, identityBefore.companionId);
    assert.equal(unwrap(await host.services.core.getIdentity(context(), {})).displayName, 'File name');
    assert.equal(unwrap(await host.services.workspace.readProfile(context(), {})).text, '# User\n\nLanguage: Chinese.');
    assert.equal(readFileSync(join(relocated, 'AGENTS.md'), 'utf8'), '# Existing instructions\n');
    assert.equal(readFileSync(join(f.repo, '.chatpet/SOUL.md'), 'utf8'), '# File name\n\nA manually edited character.');
  } finally { await host.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('workspace retains unknown files and refuses foreign identity, symlinks and malformed authority without overwriting', async () => {
  const f = fixture(); const host = createCore(f.config); let request = 0; const context = () => host.operator.request(`deny-${++request}`);
  try {
    const prefs = unwrap(await host.services.preferences.read(context(), {}));
    const saved = unwrap(await host.services.preferences.save(context(), { expectedRevision: prefs.revision, workspace: { id: 'repo', path: f.repo, title: 'Repo' }, conversation: { ...prefs.conversation } }));
    const dir = join(f.repo, '.chatpet'); writeFileSync(join(dir, 'custom.txt'), 'Preserve me');
    assert.equal(unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: saved.revision })).state, 'ready');
    assert.equal(readFileSync(join(dir, 'custom.txt'), 'utf8'), 'Preserve me');
    const soul = readFileSync(join(dir, 'SOUL.md'), 'utf8');
    const originalManifest = readFileSync(join(dir, 'manifest.json'), 'utf8');
    const foreignManifest = {...JSON.parse(originalManifest), companionId: 'foreign-companion'};
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(foreignManifest));
    assert.equal((await host.services.workspace.initialize(context(), {expectedPreferencesRevision: saved.revision})).ok, false);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), foreignManifest);
    assert.equal(readFileSync(join(dir, 'SOUL.md'), 'utf8'), soul);
    writeFileSync(join(dir, 'manifest.json'), originalManifest);
    const originalConfig = readFileSync(join(dir, 'core.json'), 'utf8');
    const retainedIdentity = unwrap(await host.services.core.getIdentity(context(), {}));
    writeFileSync(join(dir, 'core.json'), '{broken');
    assert.deepEqual(unwrap(await host.services.core.getIdentity(context(), {})), retainedIdentity,
      'The control plane can report retained identity without admitting unavailable workspace content');
    assert.equal(unwrap(await host.services.workspace.inspect(context(), {})).state, 'unavailable');
    assert.equal((await host.services.core.reviseIdentity(context(), { expectedScope:host.workspace.editScope(),expectedRevision: retainedIdentity.revision, displayName: 'Blocked', character: 'Blocked'})).ok, false);
    assert.equal(readFileSync(join(dir, 'SOUL.md'), 'utf8'), soul);
    const unauthorized = await host.services.core.reviseIdentity({...context()}, { expectedScope:host.workspace.editScope(),expectedRevision: 1, displayName: 'No', character: 'No' });
    assert.equal(unauthorized.ok, false); if (!unauthorized.ok) assert.equal(unauthorized.error.code, 'UNAUTHORIZED');
    writeFileSync(join(dir, 'core.json'), originalConfig);
    assert.equal(unwrap(await host.services.workspace.inspect(context(), {})).state, 'ready');
    rmSync(join(dir, 'SOUL.md')); symlinkSync(join(f.repo, 'outside.md'), join(dir, 'SOUL.md')); writeFileSync(join(f.repo, 'outside.md'), 'Outside');
    assert.equal(unwrap(await host.services.workspace.inspect(context(), {})).state, 'unavailable');
    assert.equal((await host.services.workspace.initialize(context(), {expectedPreferencesRevision: saved.revision})).ok, false);
    assert.equal(readFileSync(join(f.repo, 'outside.md'), 'utf8'), 'Outside');
  } finally { await host.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('a current Repo never reads, rewrites or recreates an undeclared STATE.md', async t => {
  const f = fixture(); const host = createCore(f.config); let sequence = 0;
  const context = () => host.operator.request(`retire-state-${++sequence}`);
  try {
    const original = unwrap(await host.services.preferences.read(context(), {}));
    const prefs = unwrap(await host.services.preferences.save(context(), { expectedRevision: original.revision,
      workspace: { id: 'repo', title: 'Repo', path: f.repo }, conversation: original.conversation }));
    unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: prefs.revision }));
    const dir = join(f.repo, '.chatpet');
    const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8');
    const retired = '# Old summary\n\nOwner-edited text that must be preserved.\n';
    const retiredFile = join(dir, 'STATE.md'); writeFileSync(retiredFile, retired);
    const originalOpen = fs.openSync, originalRead = fs.readFileSync;
    const guard = (read: (...args:any[])=>any) => (path:any, ...args:any[]) => {
      assert.notEqual(path, retiredFile, 'Initialization and role writes must never read the retired summary');
      return read(path, ...args);
    };
    const openGuard = t.mock.method(fs, 'openSync', guard(originalOpen));
    const readGuard = t.mock.method(fs, 'readFileSync', guard(originalRead));
    // Synchronize named fs imports used by the actual modules, then restore
    // both surfaces before the fixture itself verifies the preserved bytes.
    syncBuiltinESMExports();
    try {
      const initialized = unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: prefs.revision }));
      assert.equal(initialized.state, 'ready'); assert.ok(!initialized.files.includes('STATE.md'));
      assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), manifest);
      const identity = unwrap(await host.services.core.getIdentity(context(), {}));
      unwrap(await host.services.core.reviseIdentity(context(), { expectedScope:host.workspace.editScope(),expectedRevision: identity.revision, displayName: identity.displayName, character: 'Updated role' }));
    } finally {
      openGuard.mock.restore(); readGuard.mock.restore(); syncBuiltinESMExports();
    }
    assert.equal(readFileSync(retiredFile, 'utf8'), retired);
    rmSync(retiredFile);
    assert.equal(unwrap(await host.services.workspace.initialize(context(), { expectedPreferencesRevision: prefs.revision })).state, 'ready');
    assert.ok(!readdirSync(dir).includes('STATE.md'), 'A missing retired file must not be recreated');
  } finally { await host.close(); rmSync(f.root, { recursive: true, force: true }); }
});
