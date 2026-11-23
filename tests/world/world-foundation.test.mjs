import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as world from '../../dist/src/world/index.js';

test('the public foundation has sixteen components and ships the pinned release files', () => {
  assert.deepEqual(Object.keys(world), [
    'archive', 'bridge', 'channels', 'compaction', 'health', 'history', 'life', 'memory',
    'mood', 'persona', 'photos', 'qq', 'reflection', 'scope', 'usage', 'wechat',
  ]);
  const root = new URL('../../vendor/dsh-world/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('origin.json', root), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex'),
      manifest.adaptations?.[file]?.sha256 ?? expected, file);
  }
});

test('persona and switches can be read for one world without starting another', t => {
  const directory = mkdtempSync(join(tmpdir(), 'chatpet-world-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'persona.md');
  writeFileSync(file, '## 名字\n小汐\n\n## 性格\n安静\n');
  assert.match(world.persona.renderPersona(world.persona.readPersona(file)), /小汐[\s\S]+安静/);
  const power = world.scope.createWorldSwitch(directory);
  assert.equal(power.running(), false);
  assert.equal(power.wechatEnabled(), false);
  assert.equal(power.qqEnabled(), false);
  power.setMemoryTurns(12);
  assert.equal(world.scope.createWorldSwitch(directory).memoryTurns(), 12);
});

test('archive selection, record extraction and recent history share session/message identity', () => {
  const selected = world.archive.createArchiveSelection('workspace', () => false, id => id === 'session-one');
  assert.equal(selected('session-one'), true);
  assert.equal(selected('session-two'), false);
  const user = {
    type: 'user/message', seq: 2, time: 1794391200000, surfaceOp: 'append',
    data: { role: 'user', id: 'user-one', source: { kind: 'user' }, content: [{ type: 'text', text: 'Remember the flower.' }] },
  };
  const scope = { header: { id: 'session-one' }, worldId: 'fish', inheritedEventCount: 0, turn: 1 };
  const messages = world.archive.extractConversationRecords(user, scope);
  assert.equal(messages.length, 1);
  const turns = [{ turnId: messages[0].turnId, occurredAt: messages[0].occurredAt, messages }];
  assert.match(world.history.renderHistory(turns, 'Asia/Ho_Chi_Minh', { companion: 'Fish', partner: 'Owner' }), /Remember the flower/);
  assert.deepEqual(world.history.excludePresentMessages(turns, new Set(['user-one'])), []);
});

test('bounded lookup and host compaction retain their separate entry points', () => {
  assert.equal(world.memory.normalizeFind({ query: 'flower', limit: 3 }, 'UTC').limit, 3);
  assert.deepEqual(world.memory.normalizeRead({ ref: 'stored-ref', offset: 2, limit: 40 }), { ref: 'stored-ref', offset: 2, limit: 40 });
  assert.throws(() => world.memory.normalizeRead({ ref: 'stored-ref', offset: -1 }));
  assert.equal(typeof world.compaction.installMemoryBatch, 'function');
  assert.match(world.compaction.formatLocalTime(new Date('2026-11-11T10:00:00Z'), 'Asia/Ho_Chi_Minh'), /17:00:00\+07:00/);
});
