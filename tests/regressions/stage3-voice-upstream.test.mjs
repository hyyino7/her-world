import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHearService} from '../../dist/src/voice/upstream/host/voice/hear.js';
import {registerVoiceProvider} from '../../dist/src/voice/upstream/host/voice/registry.js';
import {activeSpeechProvider} from '../../dist/src/voice/upstream/host/voice/speech-registry.js';

const require = createRequire(import.meta.url);

test('the Voice upstream entry shares synthesis registration and revocation across ESM and CJS', t => {
  const {activeVoiceProvider} = require('../../dist/src/voice/upstream/host/voice/registry.js');
  const provider = {id:'fixture-voice', synthesize:async () => Buffer.from('fixture audio')};
  const revoke = registerVoiceProvider(provider);
  t.after(revoke);
  assert.equal(activeVoiceProvider(), provider);
  revoke();
  assert.equal(activeVoiceProvider(), null);
});

test('CJS recognition providers are used by the ESM service and receive caller cancellation', async t => {
  const {registerSpeechProvider} = require('../../dist/src/voice/upstream/host/voice/speech-registry.js');
  const entered = Promise.withResolvers();
  const provider = {id:'fixture-speech', transcribe:(_audio, signal) => {
    entered.resolve(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  }};
  const revoke = registerSpeechProvider(provider);
  t.after(revoke);
  assert.equal(activeSpeechProvider(), provider);

  const speech = createHearService({speechToText:() => undefined});
  const caller = new AbortController();
  const recording = speech.hear({audio:'AA=='}, caller.signal);
  const providerSignal = await entered.promise;
  assert.equal(providerSignal.aborted, false);
  caller.abort();
  assert.equal(providerSignal.aborted, true);
  assert.equal((await recording).reason, 'generate-error');

  revoke();
  assert.equal(activeSpeechProvider(), null);
  assert.equal((await speech.hear({audio:'AA=='})).reason, 'unsupported');
});
