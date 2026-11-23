import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../../dist/src/core/index.js';
import {CONSOLE_WALLET_IMPORT_FILE, CONSOLE_WALLET_STEP, freshWalletImportProof, HOME_STORAGE_STEP, storageManifest} from '../../dist/src/core/storage-migration.js';
import {settingsHandler} from '../../dist/src/console/settings.js';
import {inspectRepoBinding} from '../../scripts/lib/repo-storage.mjs';
import {resolveCompanionHome} from '../../dist/src/core/companion-foundation.js';
import {cordisFixture} from '../behavior-list/entries-lifecycle.test.mjs';
import {economyPaths, offlineFixture} from './offline-helpers.mjs';
import {read} from './helpers.mjs';

async function initialize(t, {portable = false} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'migration-binding-')));
  const repo = join(root, 'repo'), managed = join(repo, '.chatpet');
  mkdirSync(repo);
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const config = {dataDir:portable ? join(managed, 'data/core') : join(root, 'core'),
    companionId:'fixture', scopeId:'fixture-scope', ownerActorId:'fixture-owner', displayName:'Fixture', character:''};
  const host = createCore(config), request = () => host.operator.request('binding-fixture');
  try {
    const before = await host.services.preferences.read(request(), {});
    assert.ok(before.ok);
    const saved = await host.services.preferences.save(request(), {expectedRevision:before.value.revision,
      workspace:{id:'repo', path:repo, title:'Fixture'}, conversation:before.value.conversation});
    assert.ok(saved.ok);
    const result = await host.services.workspace.initialize(request(), {expectedPreferencesRevision:saved.value.revision});
    assert.equal(result.value?.state, 'ready');
    return {root, repo, managed, config, prefs:saved.value};
  } finally { await host.close(); }
}

async function snapshot(host) {
  const signal = new AbortController().signal;
  const result = await settingsHandler(() => host, () => undefined)('snapshot', {requestId:'binding-snapshot', input:{}},
    signal, {signal, principal:{kind:'owner'}});
  assert.ok(result.ok, result.error?.code);
  return result.value;
}

async function assertRepairHint(host) {
  const {workspace, migrationHelp} = await snapshot(host);
  assert.equal(workspace.state, 'migration-required');
  assert.equal(workspace.migrationReason, 'binding-not-migratable');
  assert.match(migrationHelp, /工作区选择和绑定.*v0\.5\.0 tag/);
}

test('旧版选了 B，初始化留在 A，设置指向原版本修复绑定', async t => {
  const f = await initialize(t), other = join(f.root, 'other');
  mkdirSync(other);
  let host = createCore(f.config);
  try {
    const result = await host.services.preferences.save(host.operator.request('select-other'), {
      expectedRevision:f.prefs.revision, workspace:{id:'other', path:other, title:'Other'}, conversation:f.prefs.conversation});
    assert.ok(result.ok);
    await host.close();
    rmSync(join(f.managed, 'data/storage-manifest.json'));
    assert.equal(inspectRepoBinding(f.config).state, 'pending');
    host = createCore(f.config);
    await assertRepairHint(host);
  } finally { await host.close(); }
});

test('迁到新设备的旧 Repo 保留原路径绑定，设置指向原版本修复绑定', async t => {
  const f = await initialize(t, {portable:true}), relocated = join(f.root, 'relocated');
  rmSync(join(f.managed, 'data/storage-manifest.json'));
  renameSync(f.repo, relocated);
  const config = {...f.config, dataDir:join(relocated, '.chatpet/data/core')};
  assert.equal(inspectRepoBinding(config).state, 'unavailable');
  const host = createCore(config);
  try { await assertRepairHint(host); }
  finally { await host.close(); }
});

test('绑定缺少 .chatpet 时可初始化，原路径暂离时显示不可用且可恢复', async t => {
  const f = await initialize(t);
  for (const [path, state] of [[f.managed, 'pending'], [f.repo, 'unavailable']]) {
    await t.test(state, async () => {
      renameSync(path, path + '-away');
      const host = createCore(f.config);
      try {
        assert.equal(inspectRepoBinding(f.config).state, state);
        const {workspace, migrationHelp} = await snapshot(host);
        assert.equal(workspace.state, state);
        assert.equal(workspace.migrationReason, undefined);
        assert.match(workspace.error, state === 'pending' ? /initialize explicitly/ : /cannot be loaded/);
        assert.equal(migrationHelp, null);
      } finally { renameSync(path + '-away', path); await host.close(); }
      const restored = createCore(f.config);
      try { assert.equal(restored.workspace.status().state, 'ready'); }
      finally { await restored.close(); }
    });
  }
});

test('只有当前初始化标记的 Repo 可以按原绑定续做', async t => {
  const f = await initialize(t);
  rmSync(f.managed, {recursive:true});
  mkdirSync(f.managed);
  writeFileSync(join(f.managed, '.initialization-pending.json'), JSON.stringify({
    companionId:f.config.companionId, scopeId:f.config.scopeId, workspaceId:'repo', modules:CONSOLE_WALLET_STEP.to,
  }));
  assert.equal(inspectRepoBinding(f.config).state, 'pending');
  const host = createCore(f.config);
  try {
    const {workspace, migrationHelp} = await snapshot(host);
    assert.equal(workspace.state, 'pending');
    assert.match(workspace.error, /retry to prepare/);
    assert.equal(migrationHelp, null);
    const reply = await host.services.workspace.initialize(host.operator.request('retry-initialize'), {expectedPreferencesRevision:f.prefs.revision});
    assert.equal(reply.value?.state, 'ready', reply.error?.code);
  } finally { await host.close(); }
});

test('只有旧初始化标记的 Repo 拒绝重新初始化并保留标记', async t => {
  const f = await initialize(t);
  rmSync(f.managed, {recursive:true});
  mkdirSync(f.managed);
  const file = join(f.managed, '.initialization-pending.json');
  const original = JSON.stringify({companionId:f.config.companionId});
  writeFileSync(file, original);
  assert.equal(inspectRepoBinding(f.config).state, 'pending');
  const host = createCore(f.config);
  try {
    await assertRepairHint(host);
    const reply = await host.services.workspace.initialize(host.operator.request('reject-old-initialization'),
      {expectedPreferencesRevision:f.prefs.revision});
    assert.equal(reply.error?.code, 'migration-required');
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(existsSync(join(f.managed, 'manifest.json')), false);
  } finally { await host.close(); }
});

test('已提示迁移的绑定暂时离线时不再提示迁移，目录恢复后仍保留进程门禁', async t => {
  const f = await initialize(t), manifest = join(f.managed, 'data/storage-manifest.json');
  const current = readFileSync(manifest), away = f.repo + '-away';
  rmSync(manifest);
  const host = createCore(f.config);
  try {
    assert.equal(host.workspace.status().migrationReason, 'storage-version-outdated');
    renameSync(f.repo, away);
    try {
      assert.equal(inspectRepoBinding(f.config).state, 'unavailable');
      const {workspace, migrationHelp} = await snapshot(host);
      assert.equal(workspace.state, 'unavailable');
      assert.equal(migrationHelp, null);
    } finally { renameSync(away, f.repo); }
    writeFileSync(manifest, current);
    assert.equal(host.workspace.status().state, 'migration-required');
  } finally { await host.close(); }
});

test('同一组待升级的合成形状，运行时可迁移与 inspectRepoBinding 的 ready 等价', async t => {
  const edit = (f, changes) => {
    const file = join(f.managed, 'manifest.json');
    writeFileSync(file, JSON.stringify({...read(file), ...changes}));
  };
  for (const [label, prepare, ready] of [
    ['schema 3', () => {}, true],
    ['schema 3 with a large manifest', f => edit(f, {description:'x'.repeat(65 * 1024)}), true],
    ['retired schema 1', f => edit(f, {schemaVersion:1}), false],
    ['retired schema 2', f => edit(f, {schemaVersion:2}), false],
    ['schema 3 with a missing declaration', f => edit(f, {files:['missing/']}), false],
    ['schema 3 with an invalid declaration', f => edit(f, {files:['../outside']}), false],
    ['marker with initialized data', f => writeFileSync(join(f.managed, '.initialization-pending.json'), JSON.stringify({companionId:f.config.companionId})), false],
    ['missing companion manifest', f => rmSync(join(f.managed, 'manifest.json')), false],
    ['foreign companion manifest', f => edit(f, {companionId:'another'}), false],
    ['hardlinked managed document', f => linkSync(join(f.managed, 'SOUL.md'), join(f.out, 'other-link')), false],
  ]) for (const version of ['absent', 'v2']) await t.test(`${label} / ${version}`, async t => {
    const f = await offlineFixture(t, false,{legacyStorage:true});
    if (version === 'v2') writeFileSync(join(f.data, 'storage-manifest.json'),
      JSON.stringify(storageManifest(f.config.companionId, HOME_STORAGE_STEP.to)));
    prepare(f);
    let offlineReady = false;
    try { offlineReady = inspectRepoBinding(f.config).state === 'ready'; } catch (error) { assert.equal(error.code, 'ERR_ASSERTION'); }
    assert.equal(offlineReady, ready);
    const host = createCore(f.config);
    try {
      const state = host.workspace.status();
      assert.equal(state.state, 'migration-required');
      assert.equal(['storage-version-outdated', 'manifest-mismatch', 'migration-incomplete'].includes(state.migrationReason), offlineReady);
      if (version === 'v2') assert.equal(state.migrationReason, ready ? 'storage-version-outdated' : 'binding-not-migratable');
    } finally { await host.close(); }
  });
});

test('旧工作区清单在当前存储版本也不能读取或被初始化改写', async t => {
  for (const schemaVersion of [1, 2]) await t.test(`schema ${schemaVersion}`, async t => {
    const f = await initialize(t);
    const path = join(f.managed, 'manifest.json');
    const current = read(path);
    const base = ['README.md', 'manifest.json', 'SOUL.md', 'USER.md', 'core.json'];
    const files = schemaVersion === 1 ? [...base, 'STATE.md'] : base;
    const original = JSON.stringify({...current, schemaVersion, files});
    writeFileSync(path, original);
    assert.throws(() => inspectRepoBinding(f.config), /Unexpected initialized workspace format/);
    const host = createCore(f.config);
    try {
      assert.equal(host.workspace.status().state, 'unavailable');
      const result = await host.services.workspace.initialize(host.operator.request('reject-old-manifest'),
        {expectedPreferencesRevision:f.prefs.revision});
      assert.equal(result.ok, false);
      assert.equal(readFileSync(path, 'utf8'), original);
      assert.equal(existsSync(join(f.managed, '.initialization-pending.json')), false);
    } finally { await host.close(); }
  });
});

for (const [scenario, reason] of [
  ['旧存储', 'storage-version-outdated'],
  ['旧轮次未完成', 'migration-incomplete'],
  ['日志损坏', 'journal-invalid'],
  ['清单损坏', 'manifest-mismatch'],
]) test(`${scenario}时保留固定拒写并提示使用 v0.5.0 工具`, async t => {
  const f = await offlineFixture(t, false,{legacyStorage:true});
  const journal = join(f.data, 'migrations.jsonl');
  if (scenario === '旧轮次未完成') writeFileSync(journal, JSON.stringify({event:'migration', id:'old-run',
    backup:f.out, manifestHash:'a'.repeat(64)}) + '\n');
  if (scenario === '日志损坏') writeFileSync(journal, '{\n');
  if (scenario === '清单损坏') writeFileSync(join(f.data,'storage-manifest.json'), '{}');
  const host = createCore(f.config);
  try {
    const {workspace, migrationHelp} = await snapshot(host);
    assert.equal(workspace.state, 'migration-required');
    assert.equal(workspace.migrationReason, reason);
    assert.match(migrationHelp, /v0\.5\.0 tag/);
    assert.doesNotMatch(migrationHelp, /--resume|0\.2\.0/);
    const signal = new AbortController().signal;
    const reply = await settingsHandler(() => host, () => undefined)('economyAction',
      {requestId:'blocked-wallet-write',input:{workspaceId:f.target.id,action:{kind:'grant',amount:2}}},
      signal, {signal,principal:{kind:'owner'}});
    assert.equal(reply.ok,false);
    assert.equal(reply.error.code,'migration-required');
    assert.equal(reply.error.effect,'none');
  } finally { await host.close(); }
});

for (const [label, mirror] of [['没有镜像 ID', {version:1}], ['镜像 ID 滞后', {version:1, homeSessionId:'old-home'}]]) {
  for (const adopted of [false, true]) test(`新装由前台开 home 后，${label}且${adopted ? '已' : '未'}采用钱包时仍无旧浏览器来源`, async t => {
    const f = await offlineFixture(t, false);
    const registry = {workspaces:[{...f.target, sessionIds:[]}], archived:[]};
    const running = await cordisFixture(t, {existing:{...f, registry}, order:adopted ? ['economy'] : []});
    const home = await resolveCompanionHome(running.ctx, running.core);
    await running.input('Synthetic foreground home turn', home.id);
    const wallet = adopted ? await running.ownerAction({kind:'grant',amount:19},'initial-wallet') : undefined;
    assert.equal(running.body,undefined);
    const mirrorPath = join(f.data, 'life/life.json'), body = JSON.stringify(mirror) + '\n';
    writeFileSync(mirrorPath, body);
    await running.restart(() => {
      const {database,adoption} = economyPaths(f);
      assert.equal(existsSync(join(f.data,'migrations.jsonl')),false);
      assert.deepEqual(read(join(f.data,CONSOLE_WALLET_IMPORT_FILE)),
        freshWalletImportProof({storageId:f.storageId,companionId:f.config.companionId}));
      assert.equal(existsSync(database),adopted);
      assert.equal(existsSync(adoption),adopted);
      assert.deepEqual(read(join(f.data,'storage-manifest.json')),storageManifest(f.config.companionId,CONSOLE_WALLET_STEP.to));
      assert.equal(readFileSync(mirrorPath, 'utf8'), body);
    });
    assert.equal(running.core.workspace.status().state, 'ready');
    assert.equal((await resolveCompanionHome(running.ctx, running.core)).id, home.id);
    assert.deepEqual(running.sessionCreateCalls, [home.id]);
    if (adopted) assert.deepEqual(await running.economy.snapshot(f.target.id),wallet);
  });
}
