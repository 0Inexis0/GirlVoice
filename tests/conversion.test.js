import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSegments } from '../src/audio/segments.js';
import { conversionBytes } from '../electron/conversion.js';
import { ElevenLabs } from '../electron/provider.js';
import { sanitizeSettings } from '../electron/settings.js';

const frame = (value = 0) => new Uint8Array(new Int16Array(1600).fill(value).buffer);
test('local segmentation ignores silence and isolated clicks, preserving speech onset and pause', () => {
  const gate = new SpeechSegments(0.5);
  for (let i = 0; i < 30; i++) assert.equal(gate.push(frame()), null);
  gate.push(frame(3000));
  for (let i = 0; i < 5; i++) assert.equal(gate.push(frame()), null);
  gate.push(frame()); gate.push(frame());
  gate.push(frame(4000), 1000); gate.push(frame(5000), 1100);
  for (let i = 0; i < 4; i++) assert.equal(gate.push(frame()), null);
  const segment = gate.push(frame());
  assert.equal(segment.audio.length, 9 * 3200);
  assert.equal(new DataView(segment.audio.buffer).getInt16(2 * 3200, true), 4000);
  assert.equal(segment.startedAt, 900);
});
test('continuous audio has bounded uploads and reset discards old speech', () => {
  const gate = new SpeechSegments();
  for (let i = 0; i < 39; i++) assert.equal(gate.push(frame(1000)), null);
  assert.equal(gate.push(frame(1000)).audio.length, 128000);
  gate.push(frame(1000)); gate.reset();
  for (let i = 0; i < 10; i++) assert.equal(gate.push(frame()), null);
});
test('audio budget rejects malformed and oversized segments and counts exact submitted samples', () => {
  assert.equal(conversionBytes(new Uint8Array(160000), 160000, 10), 320000);
  assert.throws(() => conversionBytes(new Uint8Array(3200), 320000, 10), /Audiolimit/);
  for (const invalid of [[], new Uint8Array(0), new Uint8Array(3201), new Uint8Array(192002)]) assert.throws(() => conversionBytes(invalid, 0, 10), /Audioabschnitt/);
  assert.equal(sanitizeSettings({}).mode, 'direct');
  assert.equal(sanitizeSettings({ mode: 'text', audioLimit: 60 }).audioLimit, 60);
  assert.equal(sanitizeSettings({ audioLimit: -1 }).audioLimit, 180);
});
test('conversion uploads exact PCM with multilingual STS and streaming PCM output, without transcription', async () => {
  const calls = [];
  const provider = new ElevenLabs(() => 'dummy', { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(Uint8Array.of(1, 2)); } });
  const audio = frame(2000);
  const reader = await provider.convert(audio, 'female', new AbortController().signal);
  assert.deepEqual([...(await reader.read()).value], [1, 2]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/speech-to-speech/female/stream?output_format=pcm_24000');
  const { body, headers } = calls[0].options;
  assert.equal(headers['Content-Type'], undefined);
  assert.equal(body.get('model_id'), 'eleven_multilingual_sts_v2');
  assert.equal(body.get('file_format'), 'pcm_s16le_16');
  assert.deepEqual(new Uint8Array(await body.get('audio').arrayBuffer()), audio);
  assert.equal(body.has('text'), false);
  await assert.rejects(provider.convert(audio, '../invalid', new AbortController().signal));
});
