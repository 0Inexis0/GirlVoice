import test from 'node:test';
import assert from 'node:assert/strict';
import { MonitorOutput, monitorVolume } from '../src/audio/monitor.js';
import { sanitizeSettings } from '../electron/settings.js';

function fixture(audioFactory) {
  const mainDestination = {};
  const connections = new Set([mainDestination]);
  const bus = { connect: node => connections.add(node), disconnect: node => connections.delete(node) };
  const tracks = [], audios = [];
  const context = {
    currentTime: 10,
    createGain: () => ({ gain: { value: 1, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }),
    createMediaStreamDestination: () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { stream: { getTracks: () => [track] } }; }
  };
  const monitor = new MonitorOutput(() => { const audio = audioFactory?.() || { async setSinkId(id) { this.sinkId = id; }, async play() {}, pause() { this.paused = true; } }; audios.push(audio); return audio; });
  const settings = { outputId: 'virtual', monitorDeviceId: 'headphones', monitorEnabled: true, monitorVolume: 0.5 };
  return { monitor, bus, context, settings, connections, mainDestination, tracks, audios };
}

test('monitoring adds a separate local route and never changes the main output', async () => {
  const f = fixture();
  await f.monitor.configure(f.context, f.bus, f.settings);
  assert.equal(f.connections.size, 2);
  assert.ok(f.connections.has(f.mainDestination));
  assert.equal(f.audios[0].sinkId, 'headphones');
  f.monitor.setVolume(0.2); assert.equal(f.monitor.route.gain.gain.value, 0.2);
  await f.monitor.configure(f.context, f.bus, { ...f.settings, monitorEnabled: false });
  assert.deepEqual([...f.connections], [f.mainDestination]);
  assert.equal(f.audios[0].paused, true); assert.equal(f.audios[0].srcObject, null);
  assert.equal(f.tracks[0].stopped, true);
});
test('monitoring refuses missing and duplicate output devices before audio allocation', async () => {
  const f = fixture();
  await assert.rejects(f.monitor.configure(f.context, f.bus, { ...f.settings, monitorDeviceId: '' }), /Kopfhörergerät/);
  await assert.rejects(f.monitor.configure(f.context, f.bus, { ...f.settings, monitorDeviceId: 'virtual' }), /anderes Gerät/);
  assert.equal(f.audios.length, 0);
});
test('stopping while setSinkId is pending cannot resurrect monitoring', async () => {
  let resolveSink;
  const f = fixture(() => ({ setSinkId: () => new Promise(resolve => { resolveSink = resolve; }), async play() { throw new Error('Must not play after stop'); }, pause() {} }));
  const pending = f.monitor.configure(f.context, f.bus, f.settings);
  f.monitor.stop(); resolveSink(); await pending;
  assert.equal(f.monitor.route, null); assert.equal(f.connections.size, 1); assert.equal(f.tracks[0].stopped, true);
});
test('failed device switch preserves the working old monitor and main output', async () => {
  let index = 0;
  const f = fixture(() => ({ async setSinkId() { if (index++ > 0) throw new Error('Device gone'); }, async play() {}, pause() {} }));
  await f.monitor.configure(f.context, f.bus, f.settings);
  const old = f.monitor.route;
  await assert.rejects(f.monitor.configure(f.context, f.bus, { ...f.settings, monitorDeviceId: 'other' }), /Device gone/);
  assert.equal(f.monitor.route, old); assert.equal(f.connections.size, 2); assert.equal(f.tracks[1].stopped, true);
  f.monitor.stop();
});
test('monitoring error only removes monitor branch', async () => {
  const f = fixture(); let reported = false; f.monitor.onError = () => { reported = true; };
  await f.monitor.configure(f.context, f.bus, f.settings);
  f.audios[0].onerror();
  assert.equal(reported, true); assert.equal(f.monitor.route, null); assert.ok(f.connections.has(f.mainDestination));
});
test('legacy settings opt out of monitoring and volume is safely bounded', () => {
  assert.equal(sanitizeSettings({}).monitorEnabled, false);
  assert.equal(sanitizeSettings({ monitorEnabled: 'true', monitorVolume: NaN }).monitorVolume, 0.5);
  assert.equal(sanitizeSettings({ monitorVolume: 8 }).monitorVolume, 1);
  assert.equal(monitorVolume(-2), 0);
});
