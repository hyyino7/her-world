import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { MemoryProcessHost } from '../../vendor/mnemosyne/src/memory-process.js';
import { MemoryClient } from '../../vendor/mnemosyne/src/memory-client.js';

const scope = { companionId: 'fixture-pet', scopeId: 'fixture-owner', workspaceId: 'fixture-repo' };

test('owner archive searches the bound Bank and rechecks corrected and forgotten originals', { timeout: 30000 }, async () => {
  const { createCore } = await import('../../dist/src/core/index.js');
  const { settingsHandler } = await import('../../dist/src/console/settings.js');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pet-settings-archive-')));
  const repos = ['A', 'B'].map(id => {
    const path = join(root, id);
    mkdirSync(path);
    return { id, path, title: id, status: async () => 'ok', sessionIds: [] };
  });
  const host = createCore({ dataDir: join(root, 'core'), ...scope, ownerActorId: 'owner',
    displayName: 'Fish', character: 'Fixture', memory: { python: resolve('.venv/bin/python'), dataDir: join(root, 'memory') } });
  const registry = { list: () => repos, get: id => repos.find(repo => id === repo.id) };
  const handler = settingsHandler(() => host, () => registry, () => ['memory', 'archive', 'persona']);
  const signal = new AbortController().signal;
  let requestId = 0;
  const call = (name, input) => handler(name, { requestId: String(++requestId), input }, signal, { principal: { kind: 'owner' }, signal });
  async function value(name, input) {
    const result = await call(name, input);
    assert.ok(result.ok, JSON.stringify(result.error));
    return result.value;
  }
  async function bind(workspaceId) {
    const { preferences } = await value('snapshot', {});
    const prefs = await value('preferences', { workspaceId, expectedRevision: preferences.revision, conversation: preferences.conversation });
    await value('initialize', { expectedPreferencesRevision: prefs.revision });
  }
  try {
    await bind('A');
    assert.equal(host.native.memory.connection.lifecycle, 'stopped');
    const find = workspaceId => value('archiveFind', { workspaceId, query: 'tea' });
    assert.deepEqual((await find('A')).items, []);
    const port = host.native.memory.connection;
    const observe = (id, text) => port.call('observe', { source_id: id, content: text, revision: '1', actor_id: 'owner' });
    await observe('tea-v1', 'I drink jasmine tea.');
    const memory = await port.call('propose', { operation_id: 'tea', content: 'Jasmine tea', sources: [{ id: 'tea-v1', revision: '1' }] });
    assert.ok((await find('A')).items.some(hit => hit.id === memory.id && hit.excerpt === memory.content));
    const item = { workspaceId: 'A', memoryId: memory.id };
    assert.deepEqual((await value('archiveRead', item)).dialogue, [{ role: 'user', text: 'I drink jasmine tea.' }]);
    await observe('tea-v2', 'I now drink mint tea.');
    const corrected = await port.call('correct', { memory_id: memory.id, expected_version: memory.version,
      content: 'Mint tea', sources: [{ id: 'tea-v2', revision: '1' }] });
    const updated = await value('archiveRead', item);
    assert.equal(updated.content, 'Mint tea');
    assert.deepEqual(updated.dialogue, [{ role: 'user', text: 'I now drink mint tea.' }]);
    await bind('B');
    assert.equal((await call('archiveRead', item)).error.code, 'STALE_BINDING');
    assert.deepEqual((await find('B')).items, []);
    assert.equal((await call('archiveRead', { ...item, workspaceId: 'B' })).error.code, 'INELIGIBLE');
    await bind('A');
    assert.equal((await value('archiveRead', item)).content, 'Mint tea');
    await port.call('withdraw', { memory_id: memory.id, expected_version: corrected.version });
    assert.equal((await call('archiveRead', item)).error.code, 'INELIGIBLE');
    assert.ok((await find('A')).items.every(hit => hit.id !== memory.id));
  } finally {
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('P2 owned service/client: ready, scoped replay, actual exit and restart', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-p2-process-'));
  const host = new MemoryProcessHost({ serviceRoot: resolve('vendor/mnemosyne/service'),
    token: '-fixture-leading-option-token',
    serviceEntry: resolve('src/memory/main.py'), serviceEnv: { CHATPET_MEMORY_SCOPE: JSON.stringify(scope) },
    python: resolve('.venv/bin/python'), dataDir: root });
  try {
    const began = Date.now();
    const info = await host.start({ timeoutMs: 5000 });
    const rssKiB = Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(info.pid)], { encoding: 'utf8' }).trim());
    const client = new MemoryClient(info);
    assert.ok(await client.health());
    await assert.rejects(client.request('POST', '/pet/v1/recall', { scope: { ...scope, scopeId: 'other' }, query: '' }), { status: 403 });
    const body = { scope, source_id: 'synthetic-source', content: 'Owner preference tea', revision: '1', actor_id: 'fixture-owner' };
    const first = await client.request('POST', '/pet/v1/observe', body);
    const replay = await client.request('POST', '/pet/v1/observe', body);
    assert.equal(first.observationId, replay.observationId);
    assert.equal(replay.state, 'duplicate');
    const stopped = await host.stop();
    assert.equal(stopped.state, 'stopped');
    assert.equal(host.child, null);
    assert.throws(() => process.kill(info.pid, 0), { code: 'ESRCH' });
    const restarted = await host.start({ timeoutMs: 5000 });
    const again = await new MemoryClient(restarted).request('POST', '/pet/v1/observe', body);
    assert.equal(again.observationId, first.observationId);
    console.log(JSON.stringify({ check: 'P2-01', fixture: true, elapsedMs: Date.now() - began, rssKiB, externalModels: 0 }));
  } finally {
    assert.equal((await host.stop()).state, 'stopped', 'No unresolved real child may pass P2');
    rmSync(root, { recursive: true, force: true });
  }
});

test('P2 injected stop failure retains ownership and refuses replacement', async () => {
  const host = new MemoryProcessHost();
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null, killed: false, kill: () => false });
  host.child = child;
  const stopped = await host.stop({ timeoutMs: 10 });
  assert.equal(stopped.state, 'unresolved');
  assert.equal(host.child, child);
  await assert.rejects(host.start(), /unresolved/);
  child.signalCode = 'SIGTERM';
  child.emit('exit');
  assert.equal((await host.stop()).state, 'stopped');
});
