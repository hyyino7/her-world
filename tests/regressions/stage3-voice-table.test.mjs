import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {VoiceTable} from '../../dist/src/core/tables/voice.js';

test('voice cancellation also settles a provider that aborts and throws synchronously', async t => {
  const ctx = new Context();
  const table = new VoiceTable();
  const caller = new AbortController();
  const registration = table.register(ctx, {
    availability: () => ({speak: true, hear: false}),
    handle() {
      caller.abort();
      throw Error('provider failed during cancellation');
    },
  });
  t.after(registration.revoke);
  const call = table.lookup(ctx, caller.signal);
  await assert.rejects(call.handle({rest: 'voice/speak', method: 'POST'}), {name: 'AbortError'});
});
