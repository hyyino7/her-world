import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type CoreConfig } from '../../src/core/index.js';
import {NativeMemory} from '../../src/core/native/memory.js';
import { settingsHandler } from '../../src/console/settings.js';
import { reject } from '../../src/core/storage.js';
import { emotionConsoleOperations } from '../../src/emotion/plugin.js';
import { lifeConsoleOperations } from '../../src/living/plan/plugin.js';
import type { Result } from '../../src/contracts/common.js';
import { estimateTokens } from '#dsh-world/console/snapshot';
const unwrap = <T>(value: Result<T>): T => { if (!value.ok) assert.fail(value.error.code); return value.value; };
const fixture = () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'chatpet-settings-')));
  const config: CoreConfig = { dataDir: join(directory,'.chatpet/data/core'), companionId: 'settings-fish', scopeId: 'settings-scope', ownerActorId: 'owner', displayName: 'Initial', character: 'Initial character' };
  return { directory, config };
};

test('migration-required exposes the settings snapshot and rejects companion endpoints before dispatch', async () => {
  const f = fixture(), host = createCore(f.config);
  const target = {id:'old-repo', title:'Synthetic Repo', path:f.directory};
  const request = () => host.operator.request('migration-settings');
  const signal = new AbortController().signal;
  try {
    const prefs = unwrap(await host.services.preferences.read(request(), {}));
    const saved = unwrap(await host.services.preferences.save(request(), {
      expectedRevision:prefs.revision, workspace:target, conversation:prefs.conversation,
    }));
    unwrap(await host.services.workspace.initialize(request(), {expectedPreferencesRevision:saved.revision}));
    rmSync(join(f.directory, '.chatpet/data/storage-manifest.json'));
    const route = settingsHandler(() => host, () => undefined);
    const call = (endpoint:string, input:object, kind='owner') =>
      route(endpoint, {requestId:endpoint,input}, signal, {principal:{kind},signal});
    const snapshot = await call('snapshot', {});
    assert.ok(snapshot.ok);
    assert.equal((snapshot.value as {workspace:{state:string}}).workspace.state, 'migration-required');
    for (const [endpoint, input] of [
      ['initialize', {expectedPreferencesRevision:saved.revision}],
      ['preferences', {expectedRevision:saved.revision,workspaceId:null,conversation:saved.conversation}],
      ['lifeControl', {workspaceId:target.id, enabled:true}],
      ['economyView', {workspaceId:target.id}],
      ['archiveFind', {workspaceId:target.id,query:'synthetic'}],
    ] as const) {
      const result = await call(endpoint, input);
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'migration-required');
    }
    const guest = await call('snapshot', {}, 'guest');
    assert.ok(!guest.ok);
    assert.equal(guest.error.code, 'UNAUTHORIZED');
  } finally { await host.close(); rmSync(f.directory, {recursive:true,force:true}); }
});

/** Scope tests switch between complete disposable workspaces. Their inactive
 * schemas are prepared through the public initializer, not blank DB files. */
async function prepareTarget(config:CoreConfig,target:{id:string;path:string;title:string}) {
  const owner=createCore({...config,dataDir:join(target.path,'.chatpet/data/core'),memory:undefined});
  try {
    const before=unwrap(await owner.services.preferences.read(owner.operator.request('prepare.read'),{}));
    const saved=unwrap(await owner.services.preferences.save(owner.operator.request('prepare.bind'),{expectedRevision:before.revision,
      workspace:{id:target.id,path:target.path,title:target.title},conversation:before.conversation}));
    unwrap(await owner.services.workspace.initialize(owner.operator.request('prepare.initialize'),{expectedPreferencesRevision:saved.revision}));
  } finally {await owner.close();}
}

test('settings distinguish the current-turn Memory switch from its on-demand provider', async () => {
  const f = fixture();
  const host = createCore({ ...f.config, memory: { dataDir: join(f.directory, 'memory'), python: '/unused/python' } });
  const handler = settingsHandler(() => host, () => undefined);
  const signal = new AbortController().signal;
  try {
    for (const enabled of [true, false]) {
      host.native.setMemoryEnabledForNewSessions(enabled);
      const response = await handler('snapshot', { requestId: `memory-${enabled}`, input: {} },
        signal, { principal: { kind: 'owner' }, signal });
      assert.ok(response.ok);
      assert.deepEqual((response.value as { memory: unknown }).memory, { enabled, provider: 'stopped', error: null });
    }
  } finally { await host.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('Core preferences enforce owner/revision/limits and retain autonomous settings after reopen', async () => {
  const f = fixture(); let host = createCore(f.config);
  try {
    const read = () => host.services.preferences.read(host.operator.request('read'), {});
    const initial = unwrap(await read());
    assert.equal(initial.revision, 1);
    const nonOwner = await host.services.preferences.save({...host.operator.request('forbidden')}, {
      expectedRevision: 1, workspace: null, conversation: { ...initial.conversation, maxSteps: 3 },
    });
    assert.equal(nonOwner.ok, false);
    const input = { expectedRevision: 1, workspace: { id: 'workspace-a', title: 'Chatpet', path: f.directory }, conversation: { ...initial.conversation, maxSteps: 3 } };
    const context = host.operator.request('save');
    const first = unwrap(await host.services.preferences.save(context, input));
    assert.deepEqual(unwrap(await host.services.preferences.save(context, input)), first, 'same request is idempotent');
    const stale = await host.services.preferences.save(host.operator.request('stale'), input);
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, 'STALE_REVISION');
    const invalid = await host.services.preferences.save(host.operator.request('invalid'), { ...input, expectedRevision: 2, conversation: { ...input.conversation, maxSteps: 999 } });
    assert.equal(invalid.ok, false);
    assert.deepEqual(unwrap(await read()), first, 'invalid writes do not partially mutate preferences');
    const quietContext = host.operator.request('quiet');
    const quiet = unwrap(await host.services.preferences.setQuiet(quietContext, { expectedRevision: 1, quiet: true }));
    assert.deepEqual(unwrap(await host.services.preferences.setQuiet(quietContext, { expectedRevision: 1, quiet: true })), quiet);
    assert.equal(quiet.quiet, true);
    await host.close();
    host = createCore({ ...f.config, conversation: { maxSteps: 20 } });
    assert.equal(unwrap(await read()).conversation.maxSteps, 3, 'Saved autonomous settings survive config seed and restart');
    assert.equal(host.workspace.runtime.conversation.maxSteps,3);
    assert.equal(unwrap(await host.services.core.getPolicy(host.operator.request('policy'), {})).quiet, true);
  } finally { await host.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('native settings RPC rejects forged authority and unknown workspaces; independent saves refuse stale edits', async () => {
  const f = fixture(), host = createCore(f.config);
  const target = { id: 'native-workspace', path: f.directory, title: 'Native workspace', status: async () => 'ok' as const };
  let worldModules = ['persona', 'archive'];
  const handler = settingsHandler(() => host, () => ({ list: () => [target], get: id => id === target.id ? target : undefined }),
    () => worldModules);
  const signal = new AbortController().signal;
  const peer = { principal: { kind: 'owner' }, signal };
  const call = (endpoint: string, input: unknown, requestId = endpoint) => handler(endpoint, { requestId, input }, signal, peer);
  try {
    const denied = await handler('snapshot', { requestId: 'read', input: {} }, signal, { ...peer, principal: { kind: 'viewer' } });
    assert.equal(denied.ok, false);
    const snapshot = await call('snapshot', {}); assert.equal(snapshot.ok, true);
    if (!snapshot.ok) return;
    const data = snapshot.value as { identity: { revision: number }; preferences: { revision: number; conversation: Record<string, number> }; workspaces: unknown[]; worldModules: string[] };
    assert.deepEqual((snapshot.value as { memory: unknown }).memory, { enabled: false, provider: null, error: null });
    assert.deepEqual(data.worldModules, ['persona', 'archive']);
    worldModules = [];
    const unmounted = await call('snapshot', {}, 'world-unmounted');
    assert.ok(unmounted.ok);
    assert.deepEqual((unmounted.value as { worldModules: string[] }).worldModules, []);
    assert.equal(data.workspaces.length, 1);
    assert.ok(!('companionId' in data.identity));
    const forged = await call('identity', { expectedScope:host.workspace.editScope(),expectedRevision: 1, displayName: 'Changed', character: 'Changed', ownerActorId: 'fake' });
    assert.equal(forged.ok, false);
    const unknown = await call('preferences', { expectedRevision: 1, workspaceId: '/arbitrary/path', conversation: data.preferences.conversation });
    assert.equal(unknown.ok, false); if (!unknown.ok) assert.equal(unknown.error.code, 'NOT_FOUND');
    const saved = await call('identity', { expectedScope:host.workspace.editScope(),expectedRevision: 1, displayName: '中文角色', character: 'Custom character' }, 'identity-save');
    assert.equal(saved.ok, true);
    if (saved.ok) { assert.ok(!('ownerActorId' in (saved.value as object))); assert.ok(!('companionId' in (saved.value as object))); }
    const conflict = await call('identity', { expectedScope:host.workspace.editScope(),expectedRevision: 1, displayName: 'Other', character: 'Other' }, 'identity-stale');
    assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.error.code, 'STALE_REVISION');
    const bound = await call('preferences', { expectedRevision: 1, workspaceId: target.id, conversation: data.preferences.conversation }, 'workspace-save');
    assert.equal(bound.ok, true);
    const prefs = unwrap(await host.services.preferences.read(host.operator.request('prefs'), {}));
    assert.deepEqual(prefs.workspace, { id: target.id, path: target.path, title: target.title });
    assert.equal(unwrap(await host.services.core.getIdentity(host.operator.request('identity'), {})).displayName, '中文角色');
    const stopped = new AbortController(); stopped.abort();
    const cancelled = await handler('quiet', { requestId: 'cancelled', input: { expectedRevision: 1, quiet: true } }, stopped.signal, peer);
    assert.equal(cancelled.ok, false);
  } finally { await host.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('World view projects only the current bound workspace and loaded module owners', async (t) => {
  const f = fixture();
  const host = createCore(f.config);
  // Archive RPCs below mock the provider methods; no Python service or model is
  // started merely to test owner/binding/error mapping at this boundary.
  host.native.memory=new NativeMemory(host.workspace.runtime,{dataDir:join(f.directory,'memory'),python:'/unused/python'});
  const target = (id: string, sessionIds: string[]) => ({
    id, title: id, path: realpathSync(mkdtempSync(join(f.directory, 'world-'))), sessionIds, status: async () => 'ok' as const,
  });
  const a = target('a', ['session-a']), b = target('b', ['session-b', 'session-c']);
  await prepareTarget(f.config,a);await prepareTarget(f.config,b);
  let registered = [a, b];
  const registry = { list: () => registered, get: (id: string) => registered.find(workspace => workspace.id === id) };
  const modules = ['persona', 'archive', 'mood', 'memory'];
  let world = modules;
  const emotion = {
    current: (workspaceId: string) => workspaceId === a.id
      ? { mood: '轻快', at: 17, reason: 'private reason', memories: ['private memory'] } : undefined,
    catalog: { actions: [{ name: 'wave', label: '挥手', description: 'action' }], stickers: [{ name: 'sleep', description: 'sticker' }] },
    read() { assert.fail('World view does not read the full Emotion snapshot'); },
    update() { assert.fail('World view does not change Emotion'); },
  };
  const registration = host.native.consoleOperations.register('emotion', emotionConsoleOperations(emotion));
  const handler = settingsHandler(() => host, () => registry, () => world);
  const signal = new AbortController().signal;
  let seq = 0;
  const call = (endpoint: string, input: unknown, kind = 'owner') =>
    handler(endpoint, { requestId: String(++seq), input }, signal, { principal: { kind }, signal });
  const view = (workspaceId: string, section = 'profile') => call('worldView', { workspaceId, section });
  const bind = async (workspace: typeof a) => {
    const prefs = unwrap(await host.services.preferences.read(host.operator.request('prefs'), {}));
    assert.ok((await call('preferences', { expectedRevision: prefs.revision, workspaceId: workspace.id, conversation: prefs.conversation })).ok);
    assert.ok((await call('initialize', { expectedPreferencesRevision: prefs.revision + 1 })).ok);
    writeFileSync(join(workspace.path, '.chatpet/USER.md'), `Profile of ${workspace.id}`);
  };
  try {
    assert.equal((await view(a.id)).ok, false, 'unbound workspace');
    await bind(a);
    assert.equal((await call('worldView', { workspaceId: a.id, section: 'profile' }, 'viewer')).ok, false);
    assert.equal((await call('worldView', { workspaceId: a.id, section: 'profile', path: b.path })).ok, false);
    assert.equal((await call('worldView', { workspaceId: a.id })).ok, false);
    assert.equal((await view(a.id, 'unrecognized')).ok, false);
    assert.equal((await view(b.id)).ok, false, 'registered but not bound');
    const first = await view(a.id);
    const profile = host.native.context();
    assert.equal(profile.user, 'Profile of a');
    assert.deepEqual(first, { ok: true, value: { workspaceId: a.id,
      profile: { ...profile, estimatedTokens: estimateTokens(profile.identity + '\n\n' + profile.user) } } });
    const expectedEmotion = { current: { mood: '轻快', at: 17 }, actions: ['挥手'], stickers: ['sleep'] };
    writeFileSync(join(a.path, '.chatpet/USER.md'), 'x'.repeat(host.workspace.runtime.conversation.maxContextChars));
    const overBudget = await view(a.id);
    assert.ok(!overBudget.ok);
    assert.equal(overBudget.error.code, 'PROFILE_UNAVAILABLE');
    assert.deepEqual(await view(a.id, 'sessions'), { ok: true, value: { workspaceId: a.id, sessions: 1 } });
    assert.deepEqual(await view(a.id, 'emotion'), { ok: true, value: { workspaceId: a.id, emotion: expectedEmotion } });
    writeFileSync(join(a.path, '.chatpet/USER.md'), profile.user);
    const query = { workspaceId: a.id, query: 'test' };
    const memory = host.native.memory!;
    const find = t.mock.method(memory, 'findForOwner', async (id: string, text: string) => ({ results: [id, text] }));
    const read = t.mock.method(memory, 'readForOwner', async (id: string, memoryId: string) => ({ detail: [id, memoryId] }));
    for (const invalid of [{ ...query, extra: true }, { ...query, query: ' ' }, { ...query, query: 'x'.repeat(241) }])
      assert.equal((await call('archiveFind', invalid)).ok, false);
    assert.equal((await call('archiveFind', query, 'viewer')).ok, false);
    assert.equal((await call('archiveFind', { ...query, workspaceId: b.id })).ok, false);
    assert.equal((await call('archiveRead', { workspaceId: a.id, memoryId: 'x'.repeat(257) })).ok, false);
    world = ['persona'];
    assert.equal((await view(a.id, 'sessions')).ok, false);
    assert.equal((await view(a.id, 'emotion')).ok, false);
    assert.equal((await call('archiveFind', query)).ok, false);
    assert.equal(find.mock.callCount(), 0);
    assert.equal(read.mock.callCount(), 0);
    world = modules;
    assert.deepEqual(await call('archiveFind', query), { ok: true, value: { results: [a.id, query.query] } });
    assert.deepEqual(await call('archiveRead', { workspaceId: a.id, memoryId: 'm1' }), { ok: true, value: { detail: [a.id, 'm1'] } });
    for (const status of [403, 404, 409]) {
      read.mock.mockImplementationOnce(async () => { throw Object.assign(new Error('provider detail'), { status }); });
      const denied = await call('archiveRead', { workspaceId: a.id, memoryId: 'm1' });
      assert.ok(!denied.ok);
      assert.equal(denied.error.code, 'INELIGIBLE');
    }
    find.mock.mockImplementationOnce(async () => reject('INELIGIBLE', 'retired'));
    const retired = await call('archiveFind', query);
    assert.ok(!retired.ok);
    assert.equal(retired.error.code, 'INELIGIBLE');
    find.mock.mockImplementationOnce(async () => { throw Object.assign(new Error('workspace changed'), { code: 'STALE_BINDING' }); });
    const bankChanged = await call('archiveFind', query);
    assert.ok(!bankChanged.ok);
    assert.equal(bankChanged.error.code, 'STALE_BINDING');
    find.mock.mockImplementationOnce(async () => { throw new Error('provider stopped'); });
    const stopped = await call('archiveFind', query);
    assert.ok(!stopped.ok);
    assert.equal(stopped.error.code, 'MEMORY_UNAVAILABLE');
    registered = [b];
    assert.equal((await view(a.id)).ok, false, 'no registration for bound workspace');
    registered = [{ ...a, path: b.path }, b];
    assert.equal((await view(a.id)).ok, false, 'registered path diverged');
    registered = [a, b];
    world = [];
    assert.equal((await view(a.id)).ok, false, 'World unloaded');
    world = modules;
    a.status = async () => { await bind(b); return 'ok'; };
    assert.equal((await view(a.id)).ok, false, 'binding changed during directory inspection');
    await registration.revoke();
    const second = await view(b.id);
    assert.ok(second.ok);
    const currentProfile = host.native.context();
    assert.equal(currentProfile.user, 'Profile of b');
    assert.deepEqual(second.value, { workspaceId: b.id,
      profile: { ...currentProfile, estimatedTokens: estimateTokens(currentProfile.identity + '\n\n' + currentProfile.user) },
    });
    assert.deepEqual(await view(b.id, 'sessions'), { ok: true, value: { workspaceId: b.id, sessions: 2 } });
    assert.deepEqual(await view(b.id, 'emotion'), { ok: true, value: { workspaceId: b.id, emotion: null } });
    a.status = async () => 'ok';
    read.mock.mockImplementation(async () => { await bind(a); return { detail: ['stale'] }; });
    assert.equal((await call('archiveRead', { workspaceId: b.id, memoryId: 'm2' })).ok, false,
      'a provider result must not survive a binding change while its read was pending');
    assert.equal(host.native.memory?.connection.lifecycle, 'stopped');
  } finally { await host.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('companion settings are validated, workspace-local, and read by the runtime after restart', async () => {
  const f = fixture(); let host = createCore(f.config);
  const makeTarget = (id: string) => ({ id, title: id, path: realpathSync(mkdtempSync(join(f.directory, 'repo-'))), status: async () => 'ok' as const });
  const a = makeTarget('a'), b = makeTarget('b');
  await prepareTarget(f.config,a);await prepareTarget(f.config,b);
  const handler = settingsHandler(() => host, () => ({ list: () => [a, b], get: id => [a, b].find(t => t.id === id) }));
  const signal = new AbortController().signal;
  let sequence = 0;
  const call = (endpoint: string, input: unknown) => handler(endpoint, { requestId: String(++sequence), input }, signal, { principal: { kind: 'owner' }, signal });
  const bind = async (target: typeof a) => {
    const prefs = unwrap(await host.services.preferences.read(host.operator.request('read'), {}));
    assert.ok((await call('preferences', { expectedRevision: prefs.revision, workspaceId: target.id, conversation: prefs.conversation })).ok);
    assert.ok((await call('initialize', { expectedPreferencesRevision: prefs.revision + 1 })).ok);
  };
  try {
    await bind(a);
    const defaults = host.workspace.companionConfiguration();
    assert.equal(host.workspace.companionSettings().workAnimationDelaySeconds, 5);
    const settings = { ...defaults, desktopClickSound:false, desktopReplyBubble:false, desktopFixed:true, desktopSize:200, desktopWhisperMinutes:7, desktopBalanceMinutes:20, desktopBubbleSeconds:15, stickerProbabilityPercent: 0, recentMoodHours: 2, memorySummaryTurns:7, memorySummaryIdleMinutes:3, memorySummaryMinimumMinutes:1, memoryRecallCount:5, memoryRecallBlockChars:256 };
    assert.equal((await call('companion', { workspaceId: a.id, expectedSettings: defaults, settings: { ...settings, recentActionCount: -1 } })).ok, false);
    assert.equal((await call('companion', { workspaceId:a.id, expectedSettings:defaults, settings:{...settings,desktopClickSound:'yes'} })).ok,false);
    assert.ok((await call('companion', { workspaceId: a.id, expectedSettings: defaults, settings })).ok);
    assert.equal((await call('companion', { workspaceId: a.id, expectedSettings: defaults, settings: defaults })).ok, false);
    await host.close(); host = createCore(f.config);
    assert.deepEqual(host.workspace.companionConfiguration(), settings);
    await bind(b);
    assert.deepEqual(host.workspace.companionConfiguration(), defaults);
    assert.equal((await call('companion', { workspaceId: a.id, expectedSettings: defaults, settings })).ok, false);
    await bind(a);
    assert.deepEqual(host.workspace.companionConfiguration(), settings);
  } finally { await host.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('Life settings require owner, current binding and finite actions before invoking the module', async () => {
  const f = fixture(); const host = createCore(f.config);
  const repo = realpathSync(f.directory), signal = new AbortController().signal;
  try {
    const prefs = unwrap(await host.services.preferences.read(host.operator.request('life-read'), {}));
    const saved = unwrap(await host.services.preferences.save(host.operator.request('life-bind'), {
      expectedRevision: prefs.revision, workspace: {id:'life-repo',path:repo,title:'Life'}, conversation:prefs.conversation,
    }));
    unwrap(await host.services.workspace.initialize(host.operator.request('life-init'), {expectedPreferencesRevision:saved.revision}));
    const calls: string[] = [];
    const life = {snapshot:async () => {calls.push('read');return {};}, control:async () => {calls.push('control');return {};}, act:async () => {calls.push('act');return {};}};
    host.native.consoleOperations.register('life', lifeConsoleOperations(life as never));
    const handler = settingsHandler(() => host, () => undefined);
    const run = (endpoint: string, input: object, kind='owner') => handler(endpoint, {requestId:Math.random().toString(),input}, signal, {principal:{kind},signal});
    for (const result of [await run('lifeControl',{workspaceId:'life-repo',enabled:true},'guest'),
      await run('lifeAction',{workspaceId:'other',action:'water'}), await run('lifeAction',{workspaceId:'life-repo',action:'run-shell'}),
      await run('lifeControl',{workspaceId:'life-repo',enabled:'true'})]) assert.equal(result.ok,false);
    assert.deepEqual(calls,[]);
    assert.equal((await run('lifeAction',{workspaceId:'life-repo',action:'water'})).ok,true);
    assert.deepEqual(calls,['act']);
  } finally {await host.close();rmSync(f.directory,{recursive:true,force:true});}
});
