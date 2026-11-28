// Reconcile the installed host's actual adapter dispatches against the Core ledger.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mountFixtureServices} from '../lib/native-fixture-mount.mjs';
import {say} from './lib/native-conversation-scenarios.mjs';
import {mountInstalledStandard} from './lib/native-standard-preset.mjs';

const app = '/Applications/DeepSeek Harness.app/Contents';
const anchor = join(app, 'Resources/app.asar/dsh/package.json');
const provider = 'usage-fixture', chatModel = 'local-chat', summaryModel = 'local-summary';
const contextWindow = 262144, thresholdRatio = 0.125;
const variants = ['default', 'override'];

function runInstalled() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'her-world-native-usage-')));
  try {
    const profiles = {};
    for (const variant of variants) {
      const dir = join(root, variant);
      mkdirSync(dir);
      const child = spawnSync(join(app, 'MacOS/DeepSeek Harness'),
        ['--expose-internals', fileURLToPath(import.meta.url), '--profile', variant], {
          cwd: dir, stdio: 'inherit', timeout: 90000,
          env: {...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: dir, DSH_HOME: join(dir, 'dsh'),
            DSH_AGENTS_HOME: join(dir, 'agents'), DSH_TELEMETRY_DISABLED: '1'},
        });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, `${variant} worker: ${child.signal ?? child.status}`);
      profiles[variant] = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    }
    const host = profiles.default.host;
    assert.equal(profiles.override.host, host);
    console.log(JSON.stringify({ok: true, host, paidCalls: 0, profiles}));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

async function checkProfile(variant) {
  assert.ok(variants.includes(variant));
  const dir = realpathSync(process.cwd()), home = join(dir, 'dsh');
  assert.equal(process.env.DSH_HOME, home);
  assert.equal(process.env.DSH_AGENTS_HOME, join(dir, 'agents'));
  assert.equal(process.env.HOME, dir);
  const hostRequire = createRequire(anchor);
  const load = name => import(hostRequire.resolve('@deepseek-ai/' + name));
  const version = hostRequire('./package.json').version;
  assert.equal(version, '0.2.2-rc.5', 'This check qualifies the rc.5 runtime');
  const {resolveDshHome, resolveAgentsHome} = await load('dsh-home-paths');
  assert.equal(resolveDshHome(), home);
  assert.equal(resolveAgentsHome(), join(dir, 'agents'));
  const boot = await load('dsh-app-boot');
  const profileDir = boot.resolveProfileDir('desktop');
  assert.equal(profileDir, join(home, 'profiles/desktop'));
  boot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  const override = variant === 'override';
  if (override) {
    // A profile config replaces the entire row. Derive it from the installed bundle.
    const profile = boot.loadProfileDirectory('usage-check', profileDir, anchor);
    const rows = boot.composeEntries(profile.layers.map(layer => layer.patches));
    const {id, config} = rows.find(row => row.id === 'preset-standard');
    const group = config.plugins.find(row => row.id === 'compaction');
    const basic = group.config.find(row => row.name === '@deepseek-ai/dsh-compaction-basic');
    basic.config = {...basic.config, thresholdRatio, retainTokens: 1, maxTokens: 512,
      summarizationProvider: provider, summarizationModel: summaryModel};
    writeFileSync(profile.patchPath, JSON.stringify([{id, config}]));
  }

  const {Context} = await load('cordis'), {LlmAdapter, createUserMessage} = await load('dsh-llm');
  const core = await import('../../dist/src/core/plugin.js');
  const {readLedger, usageDay} = await import('../../dist/src/core/usage/ledger.js');
  const {readGaps} = await import('../../dist/src/core/usage/gaps.js');
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(join(app, 'Resources/app.asar/dsh/index.js')).href;
  const root = join(dir, 'workspace'), usageDir = join(root, '.chatpet/data/usage');
  mkdirSync(root);
  const firstDay = usageDay(Date.now());
  const input = 'INPUT_' + randomUUID(), output = 'OUTPUT_' + randomUUID();
  const calls = [], sections = {};
  class Fixture extends LlmAdapter {
    async resolveModel(provider, id) {
      return {provider, id, name: id, systemPromptUpdate: 'in-history', context: {contextWindow}};
    }
    async *stream(options) {
      const n = calls.length + 1;
      const usage = {inputTokens: 10 + n, outputTokens: 20 + n, cacheReadTokens: n, cacheWriteTokens: 2 * n, reasoningTokens: 3};
      const samples = n === 2 ? [{inputTokens: 1, outputTokens: 1}, usage] : [usage];
      const {sessionId, purpose, provider, model, maxTokens} = options;
      calls.push({sessionId, purpose: purpose ?? null, provider, model, maxTokens, usage, reports: samples.length,
        sawInput: options.messages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && b.text.includes(input)))});
      for (const sample of samples) yield {type: 'usage', usage: sample};
      yield* say(output);
    }
  }
  function ledger() {
    return readLedger(root, db => db.prepare('SELECT * FROM calls ORDER BY rowid').all()) ?? [];
  }
  function gaps() {
    // Include both ending days if this short check crosses local midnight.
    const sum = {writeFailed: 0, unbound: 0, rebound: 0};
    for (const day of new Set([firstDay, usageDay(Date.now())])) {
      const counts = readGaps(ctx.petCore.workspace.runtime.store, day);
      for (const key of Object.keys(sum)) sum[key] += counts[key];
    }
    return sum;
  }
  const result = r => { assert.ok(r.ok, JSON.stringify(r.error)); return r.value; };
  const mountCore = () => ctx.plugin(core, {cwd: root, dataDir: join(root, '.chatpet/data/core'),
    scopeId: 'fixture', companionId: 'fish', ownerActorId: 'owner', displayName: 'Usage fixture', character: 'Synthetic companion'});
  try {
    const mount = await mountFixtureServices(ctx, load, root);
    await mountInstalledStandard(ctx, hostRequire);
    await mount('dsh-agent-default-model', {provider, model: chatModel});
    ctx.llm.registerAdapter([provider], new Fixture());
    const component = await mountCore();
    const host = ctx.petCore, workspace = await ctx.workspaceRegistry.create(root, 'Disposable usage');
    const req = id => host.operator.request('usage-' + id);
    const prefs = result(await host.services.preferences.read(req('read'), {}));
    const bound = result(await host.services.preferences.save(req('bind'), {expectedRevision: prefs.revision,
      conversation: prefs.conversation, workspace: {id: workspace.id, path: root, title: workspace.title}}));
    result(await host.services.workspace.initialize(req('init'), {expectedPreferencesRevision: bound.revision}));
    const handle = await ctx.agents.create({sessionId: 'usage-check', meta: {cwd: root, agentPreset: 'standard'},
      agentOptions: {provider, model: chatModel, maxTokens: 1024},
      setup: async scope => { await ctx.agentPresets.mount(scope, 'standard'); }});
    const {agent} = handle, {session} = agent;
    await workspace.attachSession(agent.id);
    assert.deepEqual(ctx.llm.listProviders().map(p => p.id), [provider]);
    assert.deepEqual(ledger(), []);

    const message = text => createUserMessage({source: {kind: 'user'}, content: [{type: 'text', text: input + ' ' + text}]});
    async function send(text) {
      const start = session.snapshotEvents().length;
      agent.followup(message(text));
      await agent.whenIdle();
      await ctx.sessions.flush(session);
      const events = session.snapshotEvents().slice(start);
      assert.equal(events.findLast(e => e.type === 'turn/end')?.data.reason.kind, 'completed', 'New chat turn completed');
      assert.ok(events.some(e => e.type === 'assistant/message' && e.data.message.content.some(b => b.text === output)),
        'Chat returned the scripted answer');
    }
    let missed = 0;
    async function checkSection(name, action, purposes, compactEntry = 'maintenance') {
      const before = ledger(), start = calls.length;
      await action();
      const dispatched = calls.slice(start), after = ledger(), added = after.slice(before.length);
      assert.deepEqual(after.slice(0, before.length), before, name + ': previous rows');
      assert.ok(dispatched.length > 0, name + ': no scripted stream');
      const readOnly = name === 'readOnly';
      if (readOnly) assert.ok(dispatched.every(call => call.purpose === null), name);
      else assert.deepEqual(dispatched.map(call => call.purpose), purposes, name + ': adapter purposes');
      assert.equal(added.length, readOnly ? 0 : dispatched.length, name + ': ledger rows vs adapter streams');
      for (const [i, call] of dispatched.entries()) {
        const whisper = call.purpose === 'chatpet-whisper', compact = call.purpose === 'compaction';
        assert.equal(call.provider, provider, name);
        assert.equal(call.model, compact && override ? summaryModel : chatModel, name);
        assert.equal(call.sessionId, whisper ? 'dsh-pet' : agent.id, name);
        if (compact && override) assert.equal(call.maxTokens, 512, 'Profile compaction override reached adapter');
        if (!compact) assert.ok(call.sawInput, name + ': input sentinel reached adapter');
        if (readOnly) continue;
        const expected = {entry: whisper ? 'chatpet-whisper' : compact ? compactEntry : 'dsh',
          preset: whisper ? '无会话' : 'standard', purpose: call.purpose, model: call.model, provider: call.provider,
          session_id: whisper ? null : call.sessionId, outcome: 'stop', input_miss: call.usage.inputTokens,
          output: call.usage.outputTokens, cache_read: call.usage.cacheReadTokens, cache_write: call.usage.cacheWriteTokens,
          reasoning: call.usage.reasoningTokens};
        for (const [field, value] of Object.entries(expected))
          assert.equal(added[i][field], value, `${name}: stream ${start + i + 1} ${field}`);
      }
      if (readOnly) missed += dispatched.length;
      const counts = gaps();
      assert.deepEqual(counts, {writeFailed: missed, unbound: 0, rebound: 0}, name + ': gaps');
      sections[name] = {streams: dispatched.length, usageReports: dispatched.reduce((sum, c) => sum + c.reports, 0),
        rows: added.length, entries: histogram(added, 'entry'),
        purposes: histogram(added, 'purpose'), models: histogram(added, 'model'), gaps: counts};
    }

    await checkSection('chat', async () => {
      for (let n = 0; n < 3; n++) await send('Synthetic conversation record. '.repeat(80));
    }, [null, null, null]);
    assert.deepEqual(calls.map(call => call.reports), [1, 2, 1], 'Second chat stream reported usage twice');

    const engine = ctx.agentPresets.serviceFor(agent, 'compaction');
    assert.ok(engine, 'Mounted standard preset has a compaction service');
    await checkSection('manualCompaction', async () => {
      const start = session.snapshotEvents().length;
      const checkpoint = await engine.compactNow(agent, new AbortController().signal);
      assert.ok(checkpoint?.shadowedSeqs.length, 'Manual compaction replaced a history span');
      const events = session.snapshotEvents().slice(start);
      assert.ok(events.some(e => e.type === 'compaction/start' && e.data.turn === null), 'Idle compaction');
      assert.ok(events.some(e => e.type === 'compaction/summary'));
    }, ['compaction']);
    const triggers = ['idle compactNow after three synthetic history turns'];
    if (override) {
      await checkSection('longHistory', () => send('Synthetic pressure history. '.repeat(10000)), [null]);
      const measured = ctx.tokenMeter.measure(session).totalTokens;
      const threshold = Math.floor(contextWindow * thresholdRatio);
      assert.ok(measured >= threshold, `Synthetic history reached ${measured} of ${threshold} tokens`);
      await checkSection('pressureCompaction', async () => {
        const start = session.snapshotEvents().length;
        await send('Continue after the long history.');
        const events = session.snapshotEvents().slice(start);
        assert.ok(events.some(e => e.type === 'compaction/start' && Number.isInteger(e.data.turn)), 'In-turn compaction');
        assert.ok(events.some(e => e.type === 'compaction/summary'));
      }, ['compaction', null], 'dsh');
      triggers.push(`pre-step pressure: synthetic history ${measured} tokens >= lowered threshold ${threshold}`);
    }
    await checkSection('whisper', async () => {
      const stream = ctx.llm.stream({sessionId: 'dsh-pet', purpose: 'chatpet-whisper', provider, model: chatModel,
        messages: [message('whisper')]});
      for await (const _ of stream) { /* drain the independent call */ }
    }, ['chatpet-whisper']);

    const retained = ledger();
    await component.dispose();
    await mountCore();
    assert.notEqual(ctx.petCore, host);
    assert.deepEqual(ledger(), retained, 'Reload kept every byte of row data');
    await checkSection('reload', () => send('Continue after Core reload.'), [null]);

    const mode = statSync(usageDir).mode & 0o777;
    chmodSync(usageDir, 0o500);
    try {
      await checkSection('readOnly', () => send('Continue with read-only ledger.'), []);
    } finally {
      chmodSync(usageDir, mode);
    }
    await checkSection('writable', () => send('Continue after restoring write access.'), [null]);
    const files = readdirSync(usageDir);
    assert.ok(files.includes('ledger.sqlite'));
    for (const file of files) {
      const bytes = readFileSync(join(usageDir, file));
      for (const marker of [input, output]) assert.ok(!bytes.includes(marker), 'Content sentinel in ' + file);
    }
    const rows = ledger(), unknown = rows.filter(row => row.entry === 'unknown').length;
    assert.equal(unknown, 0);
    assert.equal(rows.length + missed, calls.length, 'All adapter streams accounted for');
    await handle.dispose();
    return {host: version, preset: 'standard', compactionTriggers: triggers, sections, retainedOnReload: retained.length,
      streams: calls.length, rows: rows.length, unknown, missed, scannedFiles: files};
  } finally {
    await ctx.fiber.dispose();
  }
}

function histogram(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? 'null';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

if (process.versions.electron && process.argv[2] === '--profile') {
  const report = await checkProfile(process.argv[3]);
  writeFileSync('result.json', JSON.stringify(report));
} else {
  runInstalled();
}
