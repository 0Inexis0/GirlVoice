import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SettingsStore, sanitizeSettings, defaults } from '../electron/settings.js';
import { ElevenLabs, parseScribeEvent, providerError } from '../electron/provider.js';
import { LinuxAudio } from '../electron/linux-audio.js';
import { PcmDecoder } from '../src/audio/pcm.js';

test('PCM stays sample-aligned across odd HTTP chunk boundaries', () => {
  const decoder = new PcmDecoder();
  assert.deepEqual([...decoder.decode(Uint8Array.of(0, 128, 255))], [-1]);
  assert.deepEqual([...decoder.decode(Uint8Array.of(127, 0))], [32767 / 32768]);
  assert.deepEqual([...decoder.decode(Uint8Array.of(0))], [0]);
  assert.equal(decoder.pending, null);
});
test('only stable plain transcripts are spoken; real repetition is retained', () => {
  assert.equal(parseScribeEvent({ message_type: 'partial_transcript', text: 'Hal' }).type, 'partial');
  const result = parseScribeEvent({ message_type: 'committed_transcript', text: ' Hallo ' });
  assert.deepEqual(result, { type: 'transcript', text: 'Hallo' });
  assert.deepEqual(parseScribeEvent({ message_type: 'committed_transcript', text: 'Hallo' }), result);
  assert.equal(parseScribeEvent({ message_type: 'committed_transcript_with_timestamps', text: 'Hallo' }), null);
  assert.equal(parseScribeEvent({ message_type: 'edited_transcript', text: 'Hallo' }), null);
  assert.equal(parseScribeEvent({ message_type: 'quota_exceeded', error: 'raw secret-ish provider details' }).type, 'error');
  assert.match(providerError(403), /Rechte/);
});
test('settings reject untrusted fields and invalid budget', () => {
  assert.deepEqual(sanitizeSettings({ apiKey: 'secret', characterLimit: -1, language: 'zz' }), defaults);
});
test('credential never reaches settings or public state; basic_text cannot persist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'girlvoice-store-'));
  const encryption = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' };
  const store = new SettingsStore(dir, encryption);
  try {
    await store.load();
    await assert.rejects(store.saveKey('test-not-a-real-key', true), /Schlüsselbund/);
    await store.saveKey('test-not-a-real-key', false);
    assert.equal(store.key, 'test-not-a-real-key');
    assert.equal(JSON.stringify(store.publicState()).includes('test-not-a-real-key'), false);
    assert.deepEqual(await readdir(dir), []);
    await store.saveSettings({ voiceId: 'alice', apiKey: 'never-save' });
    assert.equal((await readFile(path.join(dir, 'settings.json'), 'utf8')).includes('never-save'), false);
    await store.forgetKey(); assert.equal(store.key, '');
  } finally { await rm(dir, { recursive: true }); }
});
test('Linux setup uses argv, reuses existing sink, only cleans up owned modules', async () => {
  const calls = [];
  const linux = new LinuxAudio(async args => { calls.push(args); if (args[0] === 'list') return args[2] === 'sinks' ? '10\tgirlvoice_sink\tdriver\n' : ''; return '42\n'; });
  await linux.ensure(); await linux.cleanup();
  assert.equal(calls.some(c => c[1] === 'module-null-sink'), false);
  assert.ok(calls.some(c => c.includes('master=girlvoice_sink.monitor')));
  assert.deepEqual(calls.at(-1), ['unload-module', '42']);
});
test('Linux setup rolls back newly created sink if remap creation fails', async () => {
  const calls = [];
  const linux = new LinuxAudio(async args => { calls.push(args); if (args[0] === 'list') return ''; if (args[1] === 'module-remap-source') throw new Error('failed'); return '7'; });
  await assert.rejects(linux.ensure());
  assert.deepEqual(calls.at(-1), ['unload-module', '7']);
  assert.deepEqual(linux.owned, []);
});
test('REST uses fixed endpoints, credential header, voice pagination and PCM stream', async () => {
  const calls = [];
  const provider = new ElevenLabs(() => 'dummy', { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('next_page_token')) return Response.json({ voices: [{ voice_id: 'female', name: 'Alice', labels: { gender: 'female' } }], has_more: false });
    if (url.includes('/v2/voices')) return Response.json({ voices: [{ voice_id: 'male', name: 'Adam' }], has_more: true, next_page_token: 'page 2' });
    return new Response(Uint8Array.of(1, 2));
  } });
  const voices = await provider.voices(); assert.equal(voices[0].id, 'female');
  const reader = await provider.speech('Hallo', 'female', new AbortController().signal);
  assert.deepEqual([...(await reader.read()).value], [1, 2]);
  assert.equal(calls[0].options.headers['xi-api-key'], 'dummy');
  assert.match(calls.at(-1).url, /output_format=pcm_24000/);
  assert.equal(JSON.parse(calls.at(-1).options.body).model_id, 'eleven_flash_v2_5');
  await assert.rejects(provider.speech('hi', '../../bad', new AbortController().signal));
});
test('provider response details and secrets never leak into errors', async () => {
  const provider = new ElevenLabs(() => 'dummy', { fetchImpl: async () => Response.json({ detail: { status: 'quota_exceeded', message: 'SECRET' } }, { status: 401 }) });
  await assert.rejects(provider.account(), error => !error.message.includes('SECRET') && /Kontingent/.test(error.message));
});
class FakeSocket extends EventEmitter { terminate() { this.emit('close'); } }
test('Scribe waits for session_started and shuts down on cancellation', async () => {
  let socket, url;
  const controller = new AbortController(); const events = [];
  const provider = new ElevenLabs(() => 'dummy', { socketFactory: (u) => { url = u; socket = new FakeSocket(); return socket; } });
  const pending = provider.connect({ language: 'de', silence: 0.7 }, e => events.push(e), controller.signal);
  socket.emit('message', Buffer.from('{"message_type":"session_started"}'));
  assert.equal(await pending, socket); assert.match(url, /commit_strategy=vad/); assert.match(url, /language_code=de/);
  socket.emit('message', Buffer.from('{"message_type":"committed_transcript","text":"Hallo"}'));
  controller.abort();
  assert.deepEqual(events, [{ type: 'transcript', text: 'Hallo' }]);
});
test('Scribe auth failure before ready rejects promptly', async () => {
  let socket;
  const provider = new ElevenLabs(() => 'dummy', { socketFactory: () => { socket = new FakeSocket(); return socket; } });
  const pending = provider.connect({ language: 'auto', silence: 0.7 }, () => {}, new AbortController().signal);
  socket.emit('message', Buffer.from('{"message_type":"auth_error","error":"bad key"}'));
  await assert.rejects(pending, /API-Key/);
});
