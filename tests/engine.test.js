import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Vite's worklet URL import is replaced only inside this test harness.
const source = (await readFile(new URL('../src/audio/engine.js', import.meta.url), 'utf8'))
  .replace("import captureUrl from './capture-worklet.js?url';", "const captureUrl = 'test-worklet.js';")
  .replace("'./pcm.js'", JSON.stringify(new URL('../src/audio/pcm.js', import.meta.url).href))
  .replace("'./monitor.js'", JSON.stringify(new URL('../src/audio/monitor.js', import.meta.url).href))
  .replace("'./segments.js'", JSON.stringify(new URL('../src/audio/segments.js', import.meta.url).href));
const { AudioEngine } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('cancelling in-flight TTS prevents any late audio from being scheduled', async () => {
  let resolveRead, scheduled = 0, stopped = 0;
  const api = { startSpeech: async () => ({ id: '1' }), readSpeech: () => new Promise(resolve => { resolveRead = resolve; }), stopSpeech: async () => { stopped++; } };
  const engine = new AudioEngine(api, () => {});
  engine.active = true; engine.nextTime = 0;
  engine.output = { currentTime: 0, createBuffer: () => { scheduled++; } };
  const playing = engine.play('Hallo', false, 0, performance.now());
  await tick(); await engine.clearOutput();
  resolveRead({ done: false, data: Uint8Array.of(0, 1) });
  await playing;
  assert.equal(scheduled, 0); assert.equal(stopped, 1);
});
test('queue overflow reports a visible stop instead of dropping speech silently', () => {
  const events = [];
  const engine = new AudioEngine({}, event => events.push(event));
  engine.active = true; engine.running = true;
  for (let i = 0; i < 6; i++) engine.enqueue(`Text ${i}`);
  assert.equal(engine.queue.length, 5);
  assert.equal(events.at(-1).type, 'error');
});
test('clear output stops all scheduled sources and clears backlog without disabling capture', async () => {
  let stopped = 0;
  const engine = new AudioEngine({ stopSpeech: async () => {} }, () => {});
  engine.active = true; engine.queue = ['old']; engine.output = { currentTime: 12 };
  engine.sources.add({ stop: () => { stopped++; }, disconnect: () => {} });
  await engine.clearOutput();
  assert.equal(stopped, 1); assert.deepEqual(engine.queue, []); assert.equal(engine.active, true); assert.equal(engine.nextTime, 12);
});
test('cancelled preview cleanup cannot stop a newer session', async () => {
  let resolvePlay, stops = 0;
  const engine = new AudioEngine({}, () => {});
  engine.prepareOutput = async () => {};
  engine.play = () => new Promise(resolve => { resolvePlay = resolve; });
  engine.stop = async () => { stops++; };
  const oldPreview = engine.preview({ outputId: 'speaker' });
  await tick(); engine.generation++;
  resolvePlay(); await oldPreview;
  assert.equal(stops, 0);
});

function captureFixture(t) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Context {
    constructor({ sampleRate }) { this.sampleRate = sampleRate; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {}
    async close() { this.state = 'closed'; }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  globalThis.AudioContext = Context;
  globalThis.AudioWorkletNode = class { constructor() { this.port = {}; } connect() {} disconnect() {} };
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let sent = 0;
  const engine = new AudioEngine({ startCapture: async () => {}, stopCapture: async () => {}, stopSpeech: async () => {}, sendAudio: () => { sent++; } }, () => {});
  engine.prepareOutput = async () => {};
  const frame = (value = 0) => engine.captureNode.port.onmessage({ data: { buffer: new Int16Array(1600).fill(value).buffer, peak: value / 32768 } });
  t.after(() => engine.stop());
  return { engine, track, frame, sent: () => sent, settings: { mode: 'direct', silence: 0.5, inputId: 'mic', outputId: 'cable' } };
}
test('direct capture produces audio jobs without transcription; clear discards unfinished speech', async t => {
  const f = captureFixture(t); const jobs = [];
  f.engine.play = async audio => jobs.push(audio);
  await f.engine.start(f.settings);
  f.frame(2000); f.frame(2000); await f.engine.clearOutput();
  for (let i = 0; i < 5; i++) f.frame();
  assert.equal(jobs.length, 0);
  f.frame(2000); f.frame(2000);
  for (let i = 0; i < 5; i++) f.frame();
  await tick();
  assert.equal(f.sent(), 0); assert.equal(jobs.length, 1); assert.ok(jobs[0] instanceof Uint8Array);
  await f.engine.stop(); assert.equal(f.track.stopped, true);
});
test('direct preview records exactly five seconds and closes microphone before conversion', async t => {
  const f = captureFixture(t); let audio;
  f.engine.play = async bytes => { assert.equal(f.track.stopped, true); audio = bytes; };
  const preview = f.engine.preview(f.settings); await tick();
  for (let i = 0; i < 50; i++) f.frame(2000);
  await preview;
  assert.equal(audio.length, 160000); assert.equal(f.sent(), 0); assert.equal(f.engine.active, false);
});
test('silent or cancelled direct preview makes no conversion request', async t => {
  const f = captureFixture(t);
  f.engine.play = async () => { assert.fail('Must not convert'); };
  const silent = assert.rejects(f.engine.preview(f.settings), /Keine Sprache/); await tick();
  for (let i = 0; i < 50; i++) f.frame();
  await silent;
  const cancelled = assert.rejects(f.engine.preview(f.settings), /abgebrochen/); await tick();
  await f.engine.stop(); await cancelled;
  assert.equal(f.engine.previewRecording, null);
});
test('direct PCM uses conversion endpoint and late response after cancellation never schedules output', async () => {
  let resolveConversion, conversions = 0;
  const engine = new AudioEngine({ startConversion: () => { conversions++; return new Promise(resolve => { resolveConversion = resolve; }); }, startSpeech: () => assert.fail('No TTS'), readSpeech: () => assert.fail('No late read'), stopSpeech: async () => {} }, () => {});
  engine.output = { currentTime: 0 };
  const pending = engine.play(new Uint8Array(3200), false, 0, performance.now());
  await engine.clearOutput(); resolveConversion({ id: 'old' }); await pending;
  assert.equal(conversions, 1); assert.equal(engine.sources.size, 0);
});
test('direct conversion decodes PCM and allows the next request while audio is still scheduled', async () => {
  let reads = 0, connected, scheduled;
  const bus = {};
  const engine = new AudioEngine({ startConversion: async () => ({ id: 'converted' }), startSpeech: () => assert.fail('No TTS'), readSpeech: async () => ++reads === 1 ? { data: Uint8Array.of(0, 64), done: false } : { done: true }, stopSpeech: async () => {} }, () => {});
  engine.playbackBus = bus; engine.nextTime = 0;
  engine.output = {
    currentTime: 0,
    createBuffer(channels, length, rate) { assert.equal(channels, 1); assert.equal(rate, 24000); return { duration: length / rate, copyToChannel(samples) { assert.equal(samples[0], 0.5); } }; },
    createBufferSource() { return { connect(target) { connected = target; }, start(at) { scheduled = at; }, stop() {}, disconnect() {} }; }
  };
  await engine.play(new Uint8Array(3200), false, 0, performance.now());
  assert.equal(connected, bus); assert.equal(scheduled, 0.04);
  assert.equal(engine.sources.size, 1); assert.ok(engine.nextTime > engine.output.currentTime);
  await engine.clearOutput();
});
