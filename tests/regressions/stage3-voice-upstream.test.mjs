import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

test('legacy voice provider paths share the canonical registry exports', async () => {
  const legacySpeech = require('../../dist/src/desktop/upstream/host/voice/speech-registry.js');
  const speech = await import('../../dist/src/voice/upstream/host/voice/speech-registry.js');
  assert.equal(legacySpeech.registerSpeechProvider, speech.registerSpeechProvider);
  assert.equal(legacySpeech.activeSpeechProvider, speech.activeSpeechProvider);

  const legacyVoice = await import('../../dist/src/desktop/upstream/host/voice/registry.js');
  const voice = require('../../dist/src/voice/upstream/host/voice/registry.js');
  assert.equal(legacyVoice.registerVoiceProvider, voice.registerVoiceProvider);
  assert.equal(legacyVoice.activeVoiceProvider, voice.activeVoiceProvider);
});
