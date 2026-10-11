import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const temp = await mkdtemp(path.join(os.tmpdir(), 'girlvoice-qa-'));
const screenshotDir = process.env.GIRLVOICE_QA_DIR || path.join(os.tmpdir(), 'girlvoice-screenshots');
await mkdir(screenshotDir, { recursive: true });
let app;
try {
  const env = { ...process.env, GIRLVOICE_TEST_DATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.GIRLVOICE_EXECUTABLE ? { executablePath: process.env.GIRLVOICE_EXECUTABLE, args: [] } : { args: ['.'] }), env });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Device fixtures only affect this isolated UI test. No real recording or playback.
  await page.addInitScript(() => { navigator.mediaDevices.enumerateDevices = async () => [
    { kind: 'audioinput', deviceId: 'qa-mic', groupId: 'mic', label: 'QA Mikrofon' },
    { kind: 'audiooutput', deviceId: 'qa-cable', groupId: 'virtual', label: 'CABLE Input (QA)' },
    { kind: 'audiooutput', deviceId: 'qa-headphones', groupId: 'headphones', label: 'QA Kopfhörer' }
  ]; });
  await page.reload();
  await page.getByRole('heading', { name: 'Deine Stimme. Dein Sound.' }).waitFor();
  assert.equal(await page.getByLabel('Modus', { exact: true }).inputValue(), 'direct');
  await page.getByRole('heading', { name: 'Direkte Sprachumwandlung', exact: true }).waitFor();
  await page.getByLabel('Modus', { exact: true }).selectOption('text');
  await page.waitForFunction(async () => (await window.girlvoice.getSettings()).settings.mode === 'text');
  await page.reload();
  await page.getByRole('heading', { name: 'Live-Transkript', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Modus', { exact: true }).inputValue(), 'text');
  await page.getByLabel('Modus', { exact: true }).selectOption('direct');
  await page.waitForFunction(async () => (await window.girlvoice.getSettings()).settings.mode === 'direct');
  await page.getByLabel('Kopfhörer', { exact: true }).selectOption('qa-headphones');
  await page.waitForFunction(async () => (await window.girlvoice.getSettings()).settings.monitorDeviceId === 'qa-headphones');
  await page.getByRole('checkbox', { name: 'Mithören', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.monitor-panel input[type="checkbox"]')?.checked);
  await page.getByRole('slider').press('End');
  await page.waitForFunction(async () => (await window.girlvoice.getSettings()).settings.monitorVolume === 1);
  await page.reload();
  assert.equal(await page.getByRole('checkbox', { name: 'Mithören', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('slider').inputValue(), '100');
  assert.equal(await page.getByLabel('Kopfhörer', { exact: true }).inputValue(), 'qa-headphones');
  await page.screenshot({ path: path.join(screenshotDir, 'monitoring.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Mithören', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.monitor-panel input[type="checkbox"]')?.checked === false);
  assert.equal(await page.title(), 'GirlVoice');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.girlvoice.startCapture), 'function');
  // Credential roundtrip uses a dummy value in an isolated profile, never a network call.
  const storage = await page.evaluate(() => window.girlvoice.getSettings());
  await page.evaluate(remember => window.girlvoice.saveKey('girlvoice-local-test-only', remember), storage.secureStorage);
  await page.reload();
  const stored = await page.evaluate(() => window.girlvoice.getSettings());
  assert.equal(stored.hasKey, true);
  assert.equal(JSON.stringify(stored).includes('girlvoice-local-test-only'), false);
  // Real IPC guards with a dummy key. No valid upload is submitted to the provider.
  await page.evaluate(async () => { const state = await window.girlvoice.getSettings(); await window.girlvoice.saveSettings({ ...state.settings, voiceId: 'qa-voice' }); await window.girlvoice.startCapture(); });
  await assert.rejects(page.evaluate(async () => { const state = await window.girlvoice.getSettings(); return window.girlvoice.saveSettings({ ...state.settings, mode: 'text' }); }), /Mikrofon stoppen/);
  await assert.rejects(page.evaluate(() => window.girlvoice.startSpeech('No TTS', true)), /direkten Modus/);
  await assert.rejects(page.evaluate(() => window.girlvoice.startConversion(new Uint8Array(3))), /Audioabschnitt/);
  await assert.rejects(page.evaluate(() => window.girlvoice.startConversion(new Uint8Array(3200))), /Keine aktive/);
  await page.evaluate(async () => { await window.girlvoice.stopCapture(); const state = await window.girlvoice.getSettings(); await window.girlvoice.saveSettings({ ...state.settings, voiceId: '' }); });
  await page.evaluate(() => window.girlvoice.forgetKey());
  await page.reload();
  await page.getByRole('heading', { name: 'Deine Stimme. Dein Sound.' }).waitFor();
  await page.screenshot({ path: path.join(screenshotDir, 'desktop.png') });
  await page.getByRole('button', { name: 'Mikrofon starten', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('#api-key').getAttribute('type'), 'password');
  await page.getByRole('spinbutton', { name: 'Maximale TTS-Zeichen pro Sitzung' }).fill('1200');
  await page.getByLabel('Maximale Audiosekunden', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
  await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.girlvoice.getSettings())).settings.characterLimit, 1200);
  await page.screenshot({ path: path.join(screenshotDir, 'settings.png') });
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  assert.equal(await page.getByRole('spinbutton', { name: 'Maximale TTS-Zeichen pro Sitzung' }).inputValue(), '1200');
  assert.equal(await page.getByLabel('Maximale Audiosekunden', { exact: true }).inputValue(), '60');
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
  // Exercise the actual packaged AudioWorklet without microphone access or provider calls.
  const worklet = await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const html = await fetch(location.href).then(r => r.text());
    const script = html.match(/src="([^\"]+\.js)"/)[1];
    const code = await fetch(new URL(script, location.href)).then(r => r.text());
    const match = code.match(/capture-worklet-[\w-]+\.js/);
    if (!match) throw new Error('AudioWorklet not emitted as an asset');
    await context.audioWorklet.addModule(new URL(match[0], new URL(script, location.href)));
    const node = new AudioWorkletNode(context, 'girlvoice-capture');
    const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
    oscillator.connect(node); node.connect(context.destination); oscillator.start(); await context.resume();
    const result = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('No PCM')), 3000); node.port.onmessage = ({ data }) => { clearTimeout(timer); resolve({ bytes: data.buffer.byteLength, peak: data.peak, rate: context.sampleRate }); }; });
    oscillator.stop(); node.disconnect(); await context.close(); return result;
  });
  assert.equal(worklet.bytes, 3200); assert.equal(worklet.rate, 16000); assert.ok(worklet.peak > 0.5);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(screenshotDir, 'direct-voice-changer.png'), fullPage: true });
  console.log(JSON.stringify({ passed: true, checks: ['desktop-load', 'context-isolation', 'onboarding', 'settings-save-reload', 'monitoring-controls-save-reload', 'direct-text-mode-switch', 'conversion-ipc-guards', 'audio-limit-save-reload', 'password-field', 'real-audio-worklet', 'no-renderer-errors'], screenshots: screenshotDir }));
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
