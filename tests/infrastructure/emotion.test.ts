import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { DEFAULT_COMPANION_SETTINGS, type CompanionSettings } from '../../src/core/companion-settings.js';
import { decideExpression, expressionStream, readRoomMood, workAnimationEligible, type ReplyIntent } from '../../src/emotion/index.js';
import { RecentLedger } from '../../src/emotion/recent.js';

test('work starts strictly after the configured threshold and the sticker gate applies only to eligible desire', () => {
  assert.equal(workAnimationEligible(null, 9999, 5), false);
  assert.equal(workAnimationEligible(1000, 6000, 5), false);
  assert.equal(workAnimationEligible(1000, 6001, 5), true);
  const catalog = { actions: [{ name: 'spin', description: '转圈' }], stickers: [{ name: 'wave', description: '挥手' }] };
  const intent = { action: 'spin', sticker: 'wave' };
  assert.deepEqual(decideExpression(intent, catalog, { stickerProbabilityPercent: 0 }), { action: 'spin' });
  assert.deepEqual(decideExpression(intent, catalog, { stickerProbabilityPercent: 100 }), intent);
  assert.deepEqual(decideExpression({action: 'spin'}, catalog, { stickerProbabilityPercent: 100 }), {action: 'spin'});
  assert.deepEqual(decideExpression({sticker: 'unknown'}, catalog, { stickerProbabilityPercent: 100 }), {});
});

test('split native text streams and stored block ends contain only visible reply, cancelled replies never commit', async () => {
  const visible = '你好\n今天也很开心。', hidden = '\n<pet-expression>{"action":"spin","mood":"开心","roomMood":{"mood":68,"dims":{"happy":43}}}';
  const answer = visible + hidden;
  for (const cancel of [false, true]) {
    async function* stream(): AsyncGenerator<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      for (const ch of answer) yield {type: 'text-delta', index: 0, text: ch};
      yield { type: 'block-end', index: 0, block: {type: 'text', text: answer} };
      yield cancel ? {type: 'finish', reason: {kind: 'max-tokens'}} : {type: 'finish', reason: {kind: 'stop'}};
    }
    const intents: ReplyIntent[] = []; let live = '', final = '';
    for await (const chunk of expressionStream(stream(), intent => intents.push(intent))) {
      if (chunk.type === 'text-delta') live += chunk.text;
      if (chunk.type === 'block-end' && chunk.block.type === 'text') final += chunk.block.text;
    }
    assert.equal(live, visible);
    assert.equal(final, live);
    assert.equal(intents.length, cancel ? 0 : 1);
    if (!cancel) {
      assert.equal(intents[0].action, 'spin');
      assert.deepEqual(intents[0].roomMood, {mood:68, dims:{happy:43}});
    }
  }
});

test('Room emotion keeps exactly the seven old optional dimensions and their order', () => {
  assert.deepEqual(readRoomMood({mood: 55}), {mood: 55, dims: {}});
  assert.deepEqual(readRoomMood({mood: 57, dims: {jealous: 17, happy: 0, extra: -3, anger: 70}}),
    {mood: 57, dims: {happy: 0, jealous: 17}});
  const dims = {jealous: 100, sad: 20, worry: 30, heartache: 40, sweet: 50, calm: 60, happy: 0};
  const mood = readRoomMood({mood: 0, dims});
  assert.deepEqual(mood?.dims, dims);
  assert.deepEqual(Object.keys(mood?.dims ?? {}), ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous']);
  for (const value of [-1, 101, Infinity, '30']) {
    assert.equal(readRoomMood({mood: value}), undefined);
    assert.equal(readRoomMood({mood: 50, dims: {calm: value}}), undefined);
  }
  for (const value of [null, [], 0]) assert.equal(readRoomMood({mood: 50, dims: value}), undefined);
});

test('the workspace ledger grounds actual playback, applies live limits and locally retires corrected feedback', t => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'emotion-ledger-')));
  t.after(() => rmSync(path, {recursive:true, force:true}));
  mkdirSync(join(path, '.chatpet'));
  let now = 1_000_000;
  let settings: CompanionSettings = {...DEFAULT_COMPANION_SETTINGS, recentActionCount: 2, recentActionMinutes: 1, recentMoodHours: 1};
  const ledger = new RecentLedger({id:'workspace', path}, () => settings, () => now);
  const play = (id:string, status:'playing'|'ended'|'failed', kind:'expression'|'work'='expression') =>
    ledger.playback({id, name:'spin', status, kind});
  play('never','failed'); play('loop','playing','work');
  assert.equal(ledger.read().actions.length, 0);
  play('p','playing'); play('p','ended');
  const intent = { mood:'得意', reason:'转圈被夸', feedback:{playbackId:'p',quote:'这个我喜欢'} };
  ledger.reply(intent, {id:'user',text:'这个我喜欢'}, ['mem-1']);
  ledger.reply(intent, {id:'user',text:'这个我喜欢'}, ['mem-1']);
  assert.equal(ledger.read().actions[0].feedback.length, 1);
  assert.equal(ledger.read().moods.length, 1);
  play('p2','playing'); play('p3','playing');
  assert.deepEqual(ledger.read().actions.map(a=>a.id), ['p2','p3']);
  ledger.reply({...intent,feedback:{playbackId:'p2', quote:'不在原话中'}}, {id:'fake',text:'嗯'}, []);
  ledger.reply({...intent,feedback:{playbackId:'p2', quote:'喜欢'}}, {id:'u2',text:'喜欢'}, ['mem-1']);
  ledger.reply({mood:'好奇',reason:'看见新东西'}, undefined, []);
  ledger.retire('mem-1');
  assert.deepEqual(ledger.read().moods.map(m=>m.mood), ['好奇']);
  assert.equal(ledger.read().actions[0].feedback.length, 0);
  now += 61_000;
  const reopened = new RecentLedger({id:'workspace',path}, () => settings, () => now);
  assert.equal(reopened.read().actions.length, 0);
  assert.equal(reopened.read().moods[0].mood, '好奇');
  settings = {...settings, recentMoodCount: 0};
  assert.deepEqual(reopened.read().moods, []);
});
