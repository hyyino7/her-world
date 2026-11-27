import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { UsageEvidence } from '../../src/core/usage/evidence.js';

test('step attribution consumes sender evidence only at admission and preserves empty continuation steps', () => {
  const evidence = new UsageEvidence();
  const message = createUserMessage({source:{kind:'user', rpcId:'room-native'}, content:[]});
  const owner = {message, selection:{branch:{turnKind:'foreground', usageEntry:evidence.owner}}} as const;
  const life = {message, selection:{branch:{turnKind:'background', usageEntry:'life'}}} as const;
  evidence.claim('home', message.id, 'desktop');
  evidence.admit('other', [owner]);
  assert.equal(evidence.step('other'), 'dsh');
  evidence.admit('home', [life, owner]);
  evidence.admit('home', []);
  assert.equal(evidence.step('home'), 'desktop');
  evidence.admit('home', [owner]);
  assert.equal(evidence.step('home'), 'dsh');
  evidence.end('home');
  assert.equal(evidence.step('home'), undefined);
});
