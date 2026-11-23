import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { acquireMigrationMutex } from '../../scripts/companion-backup.mjs';
import { createOfflineBackup, restoreOfflineBackup, verifyOfflineBackup } from '../../scripts/lib/offline-backup.mjs';
import { exportWalletSources, reconcileWalletSources } from '../../scripts/migrate/browser-wallet.mjs';
import { hash } from '../../scripts/migrate/io.mjs';
import { migrationStatus, runMigration, runWalletBrowserOperation } from '../../scripts/migrate/runner.mjs';
import { sealWalletRollback, verifyWalletRollback } from '../../scripts/migrate/wallet-rollback.mjs';
import { economyPaths } from './offline-helpers.mjs';
import { mockDsh, planFor, read } from './helpers.mjs';
import { panelNodes, renderEconomyPanel } from '../behavior-list/economy-panel.mjs';

const project = realpathSync(new URL('../..', import.meta.url));
const load = (root, file) => import(pathToFileURL(join(root, file)).href);
const step = '0004-console-wallet';
const meal = 'food:improved-meal';

test('v0.4.0 两个旧标签在服务拒绝写入时仍能覆盖共享待办键', async t => {
  assert.ok(process.env.HER_WORLD_040_ROOT, '设置 HER_WORLD_040_ROOT 为构建好的 v0.4.0 源码检出');
  const sourceFile = join(realpathSync(process.env.HER_WORLD_040_ROOT), 'src/console/client.js');
  const storage = new Map(), view = {balance:0, inventory:[], catalog:[], ledger:[], configuration:{crops:{}}};
  const rejected = [];
  const request = async (endpoint, _input, _signal, id) => {
    if (endpoint === 'economyView') return view;
    rejected.push(id);
    throw Object.assign(Error('合成入口暂停'), {code:'UNAVAILABLE'});
  };
  const tabs = [renderEconomyPanel(request,'old-world',{sourceFile,storage}),
    renderEconomyPanel(request,'old-world',{sourceFile,storage})];
  for (const tab of tabs) {
    tab.render();
    t.after(tab.mount());
  }
  await setImmediate();
  const key = 'chatpet:economy:pending:old-world';
  for (const [index,tab] of tabs.entries()) {
    const [amount] = panelNodes(tab.render(), node => node.type === 'field' && node.props.label === '金额');
    amount.props.onChange(String(index + 1));
    const [grant] = panelNodes(tab.render(), node => node.type === 'button' && node.children[0] === '给零花钱');
    assert.equal(grant.props.disabled,false);
    await grant.props.onClick();
    assert.equal(JSON.parse(storage.get(key)).requestId, rejected[index]);
  }
  assert.equal(new Set(rejected).size, 2);
});

test('实际 v0.4.0 旧页在已清除的来源竞写，清源拒绝放行且保留新值', async t => {
  const sourceFile = join(realpathSync(process.env.HER_WORLD_040_ROOT), 'src/console/client.js');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wallet-live-tab-')));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const workspaceId = 'old-world', key = 'chatpet:economy:pending:' + workspaceId;
  const binding = {storageId:'test-storage',companionId:'test-companion',workspaceId,repoHash:hash('repo'),
    profileHash:hash('profile'),scopeId:'test-scope',ownerActorId:'test-owner'};
  const sources = ['a','b'].map(name => ({profile:join(root,name),origin:'http://127.0.0.1:32100',key}));
  const storage = new Map(), other = new Map();
  const tab = renderEconomyPanel(async endpoint => {
    if (endpoint === 'economyView') return {balance:0,inventory:[],catalog:[],ledger:[],configuration:{crops:{}}};
    throw Object.assign(Error('合成入口暂停'), {code:'UNAVAILABLE'});
  },workspaceId,{sourceFile,storage});
  tab.render();
  t.after(tab.mount());
  await setImmediate();
  const original = JSON.stringify({endpoint:'economyAction',requestId:'before',input:{workspaceId,action:{kind:'grant',amount:1}}});
  for (const item of [storage,other]) item.set(key,original);
  const slot = source => source.profile === sources[0].profile ? storage : other;
  const file = join(root,'export.json'), journal = join(root,'clear.json');
  const acquire = () => ({assertFrozen:() => true, read:source => slot(source).get(key) ?? null,
    async compareAndSet(source,expected,next) {
      assert.equal(next,null);
      assert.equal(slot(source).get(key),expected);
      slot(source).delete(key);
      if (slot(source) === other) {
        const [amount] = panelNodes(tab.render(), node => node.type === 'field' && node.props.label === '金额');
        amount.props.onChange('2');
        const [grant] = panelNodes(tab.render(), node => node.type === 'button' && node.children[0] === '给零花钱');
        await grant.props.onClick();
      }
      return true;
    }});
  await exportWalletSources({file,binding,round:randomUUID(),sources,acquire});
  const clear = () => reconcileWalletSources({file,journal,binding,sources,acquire,mode:'clear',verify:() => true});
  await assert.rejects(clear(),{code:'wallet-source-conflict'});
  assert.equal(JSON.parse(storage.get(key)).input.action.amount,2);
  assert.equal(other.has(key),false);
  await assert.rejects(clear(),{code:'wallet-source-conflict'});
  assert.equal(JSON.parse(storage.get(key)).input.action.amount,2);
  storage.delete(key);
  await assert.rejects(clear(),{code:'wallet-source-conflict'});
});

function stagePackage(root, installed, temporary) {
  mkdirSync(temporary);
  const pack = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8', env: {...process.env, npm_config_cache: join(temporary, 'npm-cache'), npm_config_update_notifier: 'false'},
  });
  const [archive] = JSON.parse(pack);
  rmSync(installed, {recursive:true, force:true});
  mkdirSync(installed);
  execFileSync('tar', ['-xf', join(temporary, archive.filename), '--strip-components=1', '-C', installed]);
  symlinkSync(join(project, 'node_modules'), join(installed, 'node_modules'), 'dir');
}

async function oldRuntime(installed, f, work) {
  const { createCore } = await load(installed, 'dist/src/core/index.js');
  const { CompanionEconomy } = await load(installed, 'dist/src/living/economy/plugin.js');
  const { CompanionBehavior } = await load(installed, 'dist/src/living/body/plugin.js');
  const { LivingView } = await load(installed, 'dist/src/living/index.js');
  const { settingsHandler } = await load(installed, 'dist/src/console/settings.js');
  const host = createCore(f.config);
  assert.equal(host.workspace.status().state, 'ready');
  const ctx = {get:() => undefined, on:() => () => {}, logger:() => ({warn(){}})};
  let body;
  const economy = new CompanionEconomy(ctx, host, {body:() => body});
  const registry = new Map([[f.target.id, {...f.target, status:async () => 'ok'}]]);
  const dispatch = settingsHandler(() => host, () => registry, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, () => economy);
  const send = async ({endpoint, input, requestId}) => {
    const {signal} = new AbortController();
    const result = await dispatch(endpoint, {input, requestId}, signal, {principal:{kind:'owner'}, signal});
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.value;
  };
  try {
    economy.prepare(f.target);
    return await work(send, () => {
      body = new CompanionBehavior(ctx, host, new LivingView({economy:() => economy}));
    });
  } finally {
    economy.stopAdmission();
    try { await Promise.all([economy.settled(),body?.close()]); }
    finally { economy.close(); await host.close(); }
  }
}

function walletState(f, checkpoint) {
  using db = new DatabaseSync(economyPaths(f).database, {readOnly:true});
  return {
    wallet: db.prepare("SELECT key,value FROM meta WHERE key IN ('balance','configuration','revision') ORDER BY key").all(),
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    uses: db.prepare('SELECT * FROM uses ORDER BY id').all(),
    requests: db.prepare('SELECT * FROM requests ORDER BY id').all(),
    ledger: db.prepare('SELECT * FROM ledger ORDER BY sequence').all(),
    body: readFileSync(checkpoint, 'utf8'),
  };
}

function importedWallet(f) {
  using db = new DatabaseSync(economyPaths(f).database, {readOnly:true});
  const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE name='console_wallet_requests'").get();
  return {
    count: table ? db.prepare('SELECT count(*) AS count FROM console_wallet_requests').get().count : 0,
    proof: db.prepare("SELECT value FROM meta WHERE key='console.wallet-import'").get()?.value,
  };
}

function killedImport(f, backup, walletExport, walletRollback, point) {
  const script = name => fileURLToPath(new URL(name, import.meta.url));
  const child = spawnSync(process.execPath, ['--import', script('./dsh-probe.mjs'), script('./wallet-rollout-child.mjs'),
    f.installation, backup, walletExport, walletRollback, point], {encoding:'utf8',
    env:{...process.env, MIGRATE_TEST_DSH_RUNNING:'0'}});
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

test('合成 v3 的原安装升级、导入断点续做和实际 v0.4.0 回退', {timeout:60000}, async t => {
  assert.ok(process.env.HER_WORLD_040_ROOT, '设置 HER_WORLD_040_ROOT 为构建好的 v0.4.0 源码检出');
  const old = realpathSync(process.env.HER_WORLD_040_ROOT);
  assert.equal(read(join(old, 'package.json')).version, '0.4.0');
  assert.equal(read(join(old, 'release.json')).version, '0.4.0');
  const { offlineFixture } = await load(old, 'tests/migrate/offline-helpers.mjs');
  const oldRunner = await load(old, 'scripts/migrate/runner.mjs');
  mockDsh(t);
  const now = Date.parse('2026-11-13T05:00:00Z');
  t.mock.timers.enable({apis:['Date'], now});
  const f = await offlineFixture(t, false, {withLegacyEconomy:true});
  const plan = planFor(f), installation = readFileSync(f.installation);
  const installed = plan.installedPackage;
  stagePackage(old, installed, join(f.out, 'old-package'));
  await oldRunner.runMigration({installation:f.installation, backup:join(f.out, 'previous-resume')});
  assert.equal(oldRunner.migrationStatus(f.installation).segment, 'settled');
  assert.deepEqual(oldRunner.migrationStatus(f.installation).steps.at(-1), {id:'0003-economy-marker', state:'complete'});
  const manifest = join(f.data, 'storage-manifest.json');
  assert.deepEqual([read(manifest).modules.core, read(manifest).modules.living], [3, 3]);

  const workspaceId = f.target.id;
  const action = (requestId, action) => ({endpoint:'economyAction', input:{workspaceId, action}, requestId});
  await oldRuntime(installed, f, async send => {
    await send(action('old-gift', {kind:'gift', itemId:meal, quantity:2}));
  });

  const { emptyHomeState } = await load(installed, 'vendor/feiyu-room-template/home-state.js');
  const directory = join(f.data, 'life'), checkpoint = join(directory, 'home.json');
  mkdirSync(directory, {recursive:true});
  const body = emptyHomeState(now);
  Object.assign(body, {needs:{hunger:.8, thirst:.8, energy:.7, bladder:.1, pain:0}, asleep:false,
    sleepPending:false, route:null, dwell:null, command:null, freeTarget:null, reactionUntil:0, lastInteractionAt:0, eventLog:[]});
  writeFileSync(checkpoint, JSON.stringify(body));

  const configure = {endpoint:'economySettings', input:{workspaceId, expectedVersion:'', next:{compostCost:17}}, requestId:'old-configure'};
  const feed = action('old-feed', {kind:'feed', itemId:meal});
  const importReading = action('old-reading', {kind:'importReading', title:'合成读物', content:'合成正文',
    source:{name:'合成浏览器来源'}});
  const tripped = work => {
    using db = new DatabaseSync(economyPaths(f).database);
    db.exec(work);
  };
  tripped("CREATE TRIGGER abort_settlement BEFORE UPDATE ON uses WHEN json_extract(NEW.value,'$.status')='consumed' BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END");
  await oldRuntime(installed, f, async (send, openBody) => {
    const view = await send({endpoint:'economyView', input:{workspaceId}, requestId:'old-view'});
    configure.input.expectedVersion = view.configurationVersion;
    assert.equal((await send(configure)).configuration.compostCost, 17);
    openBody();
    const {execution} = await send(feed);
    assert.equal(execution.status, 'running');
  });
  tripped('DROP TRIGGER abort_settlement');
  const original = walletState(f, checkpoint);
  assert.equal(JSON.parse(original.uses[0].value).status, 'reserved');
  assert.ok(JSON.parse(original.body).needs.hunger < body.needs.hunger);
  assert.deepEqual(importedWallet(f), {count:0, proof:undefined});

  const round = randomUUID();
  const sources = [configure, feed, importReading, {...feed}].map((_, index) => ({
    profile: join(f.out, 'browser', String(index)), origin: 'http://127.0.0.1:32100',
    key: 'chatpet:economy:pending:' + workspaceId,
  }));
  const browser = new Map([configure, feed, importReading, feed].map((pending, index) =>
    [sources[index].profile, JSON.stringify(pending)]));
  const legacySource = {...sources[0], profile:join(f.out,'browser','-old-page')};
  const legacyStorage = new Map();
  const tab = renderEconomyPanel(async endpoint => {
    if (endpoint === 'economyView') return {balance:0,inventory:[],catalog:[],ledger:[],configuration:{crops:{}}};
    throw Object.assign(Error('合成回包未到'), {code:'UNAVAILABLE'});
  },workspaceId,{sourceFile:join(old,'src/console/client.js'),storage:legacyStorage});
  tab.render();
  const unmount = tab.mount();
  try {
    await setImmediate();
    const [amount] = panelNodes(tab.render(), node => node.type === 'field' && node.props.label === '金额');
    amount.props.onChange('2');
    const [grant] = panelNodes(tab.render(), node => node.type === 'button' && node.children[0] === '给零花钱');
    await grant.props.onClick();
  } finally { unmount(); }
  const legacyRaw = legacyStorage.get(legacySource.key);
  assert.ok(legacyRaw);
  sources.push(legacySource);
  browser.set(legacySource.profile,legacyRaw);
  const before = new Map(browser);
  let locked = false, interrupted = false, startWriterOnRead = false;
  const economyLock = join(f.data,'economy','economy.lock');
  const acquire = () => {
    assert.equal(locked, false);
    locked = true;
    return {
      assertFrozen: () => locked,
      read(source) {
        if (startWriterOnRead) writeFileSync(economyLock,`${process.pid}:synthetic`);
        return browser.get(source.profile) ?? null;
      },
      compareAndSet(source, expected, next) {
        if ((browser.get(source.profile) ?? null) !== expected) return false;
        if (next === null) browser.delete(source.profile);
        else browser.set(source.profile, next);
        if (interrupted) throw Error('synthetic interruption after browser write');
        return true;
      },
      release: () => { locked = false; },
    };
  };

  const privateDir = join(f.out, 'private');
  mkdirSync(privateDir, {mode:0o700});
  const walletExport = join(privateDir, 'wallet.json'), walletRollback = join(privateDir, 'rollback.json');
  const browserPhase = (mode,journal) => runWalletBrowserOperation({installation:f.installation,mode,walletExport,
    walletRollback,round,sources,acquire,journal});
  const release = acquireMigrationMutex(f.repo);
  try { await assert.rejects(browserPhase('export'),{code:'lock-held'}); }
  finally { release(); }
  startWriterOnRead = true;
  await assert.rejects(browserPhase('export'),{code:'wallet-freeze-unverified'});
  assert.equal(existsSync(walletExport),false);
  startWriterOnRead = false;
  rmSync(economyLock);
  await browserPhase('export');
  const oldBackup = join(f.out, 'rollback');
  createOfflineBackup(plan, oldBackup);
  const oldFingerprint = verifyOfflineBackup(oldBackup, plan).codeFingerprint;
  sealWalletRollback({installation:f.installation, backup:oldBackup, walletExport, output:walletRollback});
  stagePackage(project, installed, join(f.out, 'new-package'));
  assert.throws(() => verifyOfflineBackup(oldBackup, plan), /matching plugin package/);
  const currentResume = join(f.out, 'resume');
  killedImport(f, currentResume, walletExport, walletRollback, 'during-import');
  assert.deepEqual(importedWallet(f), {count:0, proof:undefined});
  assert.deepEqual(walletState(f, checkpoint), original);
  const newFingerprint = verifyOfflineBackup(currentResume, plan).codeFingerprint;
  assert.notEqual(oldFingerprint, newFingerprint);
  assert.equal(migrationStatus(f.installation).segment, 'unfinished');

  const exportBytes = readFileSync(walletExport);
  writeFileSync(walletExport, exportBytes.subarray(0, -1));
  await assert.rejects(runMigration({installation:f.installation, resume:true}));
  assert.deepEqual(importedWallet(f), {count:0, proof:undefined});
  writeFileSync(walletExport, exportBytes);
  killedImport(f, currentResume, walletExport, walletRollback, 'after-resume-import');
  const imported = importedWallet(f);
  assert.equal(imported.count, 4);
  assert.ok(imported.proof);
  assert.ok(!imported.proof.includes(importReading.input.action.content));
  assert.equal(migrationStatus(f.installation).segment, 'unfinished');
  assert.deepEqual([read(manifest).modules.core, read(manifest).modules.living], [3, 3]);
  await runMigration({installation:f.installation, resume:true});
  assert.deepEqual(importedWallet(f), imported);
  const status = migrationStatus(f.installation);
  assert.deepEqual(status.steps.at(-1), {id:step, state:'complete'});
  assert.equal(status.segment, 'settled');
  assert.deepEqual([read(manifest).modules.core, read(manifest).modules.living], [3, 4]);
  assert.deepEqual(walletState(f, checkpoint), original);

  const clearJournal = join(privateDir, 'sources-cleared.json');
  interrupted = true;
  await assert.rejects(browserPhase('clear',clearJournal),/synthetic interruption/);
  assert.equal(browser.has(legacySource.profile),false);
  assert.equal(browser.size,before.size - 1);
  assert.deepEqual(Object.values(read(clearJournal).rows),['intent']);
  interrupted = false;
  assert.equal((await browserPhase('clear',clearJournal)).complete,true);
  assert.equal(browser.size, 0);

  stagePackage(old, installed, join(f.out, 'old-again'));
  assert.throws(() => verifyOfflineBackup(currentResume, plan), /matching plugin package/);
  const verifyRestore = () => verifyWalletRollback({installation:f.installation, walletExport, walletRollback});
  assert.equal(verifyRestore().backup, oldBackup);
  assert.equal(verifyOfflineBackup(oldBackup, plan).codeFingerprint, oldFingerprint);
  const restoreJournal = join(privateDir, 'sources-restored.json');
  await assert.rejects(browserPhase('restore',restoreJournal),{code:'wallet-rollback-invalid'});
  assert.equal(restoreOfflineBackup(plan, oldBackup, join(f.out, 'before-rollback')).restored, true);
  interrupted = true;
  await assert.rejects(browserPhase('restore',restoreJournal),/synthetic interruption/);
  assert.deepEqual(browser,new Map([[legacySource.profile,legacyRaw]]));
  assert.deepEqual(Object.values(read(restoreJournal).rows),['intent']);
  interrupted = false;
  assert.equal((await browserPhase('restore',restoreJournal)).complete,true);
  assert.deepEqual(browser, before);
  assert.deepEqual(readFileSync(f.installation), installation);
  assert.equal(oldRunner.migrationStatus(f.installation).segment, 'settled');
  assert.deepEqual([read(manifest).modules.core, read(manifest).modules.living], [3, 3]);
  assert.deepEqual(importedWallet(f), {count:0, proof:undefined});
  assert.deepEqual(walletState(f, checkpoint), original);

  await oldRuntime(installed, f, async (send, openBody) => {
    const readPending = index => JSON.parse(browser.get(sources[index].profile));
    assert.equal((await send(readPending(0))).configuration.compostCost, 17);
    openBody();
    assert.equal((await send(readPending(1))).execution.status, 'completed');
    assert.equal((await send(readPending(3))).execution.status, 'completed');
  });
  const after = walletState(f, checkpoint);
  assert.equal(JSON.parse(after.body).needs.hunger, JSON.parse(original.body).needs.hunger);
  assert.equal(after.requests.filter(row => row.id === configure.requestId).length, 1);
  assert.equal(after.ledger.filter(row => row.kind === 'use-consume').length, 1);
  assert.equal(JSON.parse(after.uses[0].value).status, 'consumed');
});
