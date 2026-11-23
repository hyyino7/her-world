import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {NativeTranscripts} from '../../dist/src/core/native/transcripts.js';
import {digest} from '../../dist/src/core/storage.js';
import {VoiceTable} from '../../dist/src/core/tables/voice.js';
import {Room} from '../../dist/src/room/plugin.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'room-binding-'));
  const targets = Object.fromEntries(['a', 'b'].map(id => {
    const path = join(root, id);
    mkdirSync(path);
    return [id, {id, path, sessionIds: []}];
  }));
  let target = targets.a, generation = 0;
  const rootContext = new Context();
  const workspaceRegistry = {get: id => targets[id], archivedSessionIds: []};
  const voiceTable = new VoiceTable();
  const host = {workspace: {
    status: () => ({state: 'ready', target}),
    storageId: () => target.id,
    homeScope: () => ({workspaceId: target.id, path: target.path, storageId: target.id, bootId: 'fixture', generation}),
    runtime: {identity: () => ({displayName:'Fixture'}), config: {companionId:'fish', scopeId:'scope', ownerActorId:'owner'}},
  }, native: {voiceTable}};
  const services = {workspaceRegistry, attachments: {admitPromptContent: async input => input}};
  const listeners = new Map();
  const ctx = {root: rootContext, [Context.isolate]: rootContext[Context.isolate], workspaceRegistry, petCore: host,
    on(name, listener) {listeners.set(name, listener);return () => listeners.delete(name);},
    get: name => services[name], petWorld: {sessionStatus: () => ({state:'ready'})}};
  const room = new Room(ctx);
  t.after(async () => {await room.close();rmSync(root, {recursive:true,force:true});});
  return {ctx, rootContext, room, host, voiceTable, services, targets,
    bind(id, notify = false) {
      target = targets[id];
      generation++;
      if (notify) listeners.get('pet/core.changed')?.('workspace.bind');
    },
    request(endpoint, data) {
      return room.request('a', endpoint, data, 'room-request', new AbortController().signal);
    }};
}

test('a late Room transcript restore cannot create recovery data in the replacement workspace', async t => {
  const f = fixture(t);
  const logs = f.services.petTranscripts = new NativeTranscripts(f.ctx, f.host);
  const {promise, resolve} = Promise.withResolvers();
  logs.tail = promise;
  const pending = f.request('roomChat', {text: 'hello'});
  f.bind('b');
  resolve();
  await assert.rejects(pending, error => error.detail?.code === 'STALE_BINDING');
  assert.equal(existsSync(join(f.targets.b.path, '.chatpet/data/core/native-sessions/identity.json')), false);
});

for (const [endpoint, data] of [
  ['roomChat', {text:'hello'}],
  ['roomTelevision', {image:'data:image/png;base64,AQI='}],
]) {
  test(endpoint + ' cancels the active turn and stops flushing when its binding generation changes', async t => {
    const f = fixture(t);
    const id = 'chatpet-room-' + digest('a').split(':')[1].slice(0,24) + '-1';
    f.targets.a.sessionIds.push(id);
    const entered = Promise.withResolvers(), barrier = Promise.withResolvers();
    const calls = [];
    const session = {snapshotEvents: () => []};
    const agent = {id, session, status:'idle', followup() {calls.push('followup');},
      cancel() {calls.push('cancel');}, async whenIdle() {calls.push('idle');}};
    f.ctx.sessionController = {resolveAgent: async () => ({agent})};
    f.ctx.sessions = {async flush() {calls.push('flush');entered.resolve();await barrier.promise;return true;}};
    const pending = f.request(endpoint, data);
    try {
      await entered.promise;
      f.bind('b', true);
      f.bind('a', true);
    } finally {
      barrier.resolve();
    }
    await assert.rejects(pending, error => error.detail?.code === 'STALE_BINDING');
    assert.deepEqual(calls, ['followup', 'flush', 'cancel']);
  });
}

test('a Room voice request checks the original binding at provider admission', async t => {
  const f = fixture(t);
  let admitted = 0;
  const registration = f.voiceTable.register(f.rootContext, {
    availability: () => ({speak:true,hear:true}),
    async handle() {admitted++; return {kind:'json',obj:{ok:true,text:'stale recording'}};},
  });
  t.after(registration.revoke);
  const pending = f.request('roomVoice', {operation:'hear',payload:{audio:'AQI='}});
  f.bind('b');
  f.bind('a');
  await assert.rejects(pending, error => error.detail?.code === 'STALE_BINDING');
  assert.equal(admitted, 0);
});
