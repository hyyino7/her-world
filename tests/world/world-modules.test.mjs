import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bridge, channels, health, life, mood, photos, qq, reflection, usage, wechat } from '../../dist/src/world/index.js';

function temporaryWorld(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chatpet-world-modules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('reflection reads dated diaries and keeps the companion-authored self before review', t => {
  const world = temporaryWorld(t);
  const day = '2026-11-11';
  const diaries = join(world, 'diary');
  mkdirSync(diaries);
  writeFileSync(join(diaries, day + '.md'), 'A quiet evening.');
  writeFileSync(join(diaries, 'draft.md'), 'Still writing.');
  const reader = reflection.createDiaryReader(diaries);
  assert.deepEqual(reader.dates(), [day]);
  assert.equal(reader.read(day), 'A quiet evening.');
  const selfFile = join(world, 'self.md');
  writeFileSync(selfFile, 'I enjoy drawing.');
  const snapshot = reflection.keepSelfCopy(selfFile, day);
  writeFileSync(selfFile, 'I also enjoy stargazing.');
  assert.equal(readFileSync(snapshot, 'utf8'), 'I enjoy drawing.');
});

test('the optional World mood reader renders a real value and distinguishes an empty mood file', () => {
  assert.match(mood.moodText(mood.parseMood('平静 6\n安静画画')), /平静 6/);
  assert.equal(mood.moodText(mood.parseMood('')), undefined);
});

test('Life places daily review in the companion timezone and fires an alarm only when due', () => {
  let now = new Date('2026-11-11T15:00:00Z');
  assert.deepEqual(life.nextReview(now, 'Asia/Ho_Chi_Minh'), {
    at: '2026-11-11T16:00:00.000Z', day: '2026-11-11',
  });
  const due = new Date(now.getTime() + 30_000);
  let scheduled, wakes = 0;
  const timer = life.createAlarmTimer({
    clock: () => now, dueAlarm: () => due.toISOString(), fire: () => { wakes++; },
    timers: {
      set(callback, ms) { scheduled = { callback, ms }; return scheduled; },
      clear() { scheduled = undefined; },
    },
  });
  timer.arm();
  assert.equal(scheduled.ms, 30_000);
  scheduled.callback();
  assert.equal(wakes, 0);
  now = due;
  scheduled.callback();
  assert.equal(wakes, 1);
  timer.stop();
});

test('an opt-in proactive outlet delivers the selected reply through its injected transport', async () => {
  const payload = { kind: 'reach', name: 'Fish', text: 'Good evening.' };
  const sent = [];
  const outlet = bridge.createOutlet({ name: 'desktop', kinds: ['reach'], url: '{origin}/bubble' },
    () => 'http://local.invalid', async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return Response.json({ ok: true });
    });
  await outlet.send(payload);
  assert.deepEqual(outlet.kinds, ['reach']);
  assert.deepEqual(sent, [{ url: 'http://local.invalid/bubble', body: payload }]);
});

test('channel routing uses adapter identity and distinguishes a group from a private conversation', () => {
  const sender = { channel: 'qq', accountId: 'pet', conversationId: '42', speakerId: 'qq:9' };
  const group = channels.speakerIdentity({ ...sender, conversationType: 'group', platformMessageId: 'm1' });
  assert.equal(group.platformMessageId, 'm1');
  assert.equal(group.speakerId, 'qq:9');
  assert.notEqual(channels.conversationKey(group), channels.conversationKey(channels.speakerIdentity(sender)));
  assert.throws(() => channels.speakerIdentity({ ...sender, speakerId: 'wechat:9' }));
});

test('QQ outbox reports immediate delivery separately from messages queued on disconnect', async () => {
  const sent = [];
  const outbox = qq.createOutbox({
    async send(item) { if (item === 'second') throw Error('offline'); sent.push(item); },
    dropped: () => assert.fail('An unsent message should remain queued'),
  });
  assert.equal(await outbox.send('first'), true);
  assert.equal(await outbox.send('second'), false);
  assert.deepEqual(sent, ['first']);
  assert.equal(outbox.size, 1);
  outbox.stop();
  assert.equal(outbox.size, 0);
});

test('WeChat reports activity only for a configured group and expires stale presence', () => {
  const presence = wechat.createWechatPresence();
  const now = new Date('2026-11-11T10:00:00Z');
  const report = { observedAt: now.toISOString(), groups: [
    { chatId: 'team@chatroom', count: 2, lastSpeaker: 'Lin', lastAt: now.toISOString(), lastSelf: false },
  ] };
  assert.throws(() => presence.accept({ presence: report, chats: [] }));
  presence.accept({ presence: report, chats: [{ id: 'team@chatroom', name: 'Team' }] });
  assert.match(presence.summary(now), /Team.*Lin/);
  assert.equal(presence.summary(new Date(now.getTime() + 10 * 60_000)), undefined);
});

test('album persists an attachment once and serves image bytes on demand', t => {
  const dir = temporaryWorld(t);
  const attachment = {
    ref: { attachmentId: 'fixture-image', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
    data: Uint8Array.of(1, 2, 3),
  };
  const album = photos.createPhotoStore(dir);
  let id;
  try {
    id = album.keep(attachment, 'a drawing', ['art']).id;
    assert.equal(album.keep(attachment).id, id);
  } finally { album.close(); }
  const restored = photos.createPhotoStore(dir);
  try {
    assert.equal(restored.list().total, 1);
    assert.equal(restored.list().photos[0].description, 'a drawing');
    assert.deepEqual([...restored.image(id).data], [...attachment.data]);
    restored.forget(id);
    assert.equal(restored.list().total, 0);
  } finally { restored.close(); }
});

test('health clears a prior fault when the same operation succeeds', async () => {
  const faults = new health.Faults();
  await assert.rejects(faults.track('archive', 'Archive', async () => { throw Error('unavailable'); }));
  assert.match(faults.list().join(' '), /unavailable/);
  await faults.track('archive', 'Archive', async () => {});
  assert.deepEqual(faults.list(), []);
});

test('activity describes the observed operation and home usage prices actual usage categories', () => {
  const log = usage.summarizeCall('read_image', '{"file_path":"drawing.png"}', '/fixture');
  assert.match(log.summary, /drawing\.png/);
  const step = { inputTokens: 1_000, cacheReadTokens: 10_000, outputTokens: 100 };
  const price = usage.priceCall(step, 'deepseek', 'deepseek-flash', Date.parse('2026-11-28T10:04:00Z'));
  assert.ok(Math.abs(price.yuan - 0.0016) < 1e-10);
});
