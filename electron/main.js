import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsStore, sanitizeSettings } from './settings.js';
import { ElevenLabs } from './provider.js';
import { LinuxAudio } from './linux-audio.js';
import { conversionBytes } from './conversion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.GIRLVOICE_TEST_DATA) app.setPath('userData', process.env.GIRLVOICE_TEST_DATA);
let window, store, provider, capture, captureAbort, speech, connecting = false, quitting = false;
let characters = 0, sessionLimit = 3000, directSession = null;
const linuxAudio = new LinuxAudio();
const uiUrl = new URL('../dist/index.html', import.meta.url).href;
const trusted = url => url === uiUrl;
function emit(event) { if (window && !window.isDestroyed()) window.webContents.send('voice:event', event); }
function stopSpeech() { if (speech) { speech.abort.abort(); speech.reader?.cancel().catch(() => {}); speech = null; } }
function stopCapture() { directSession = null; captureAbort?.abort(); captureAbort = null; capture?.terminate(); capture = null; connecting = false; }
function stopAll() { stopCapture(); stopSpeech(); }
function handle(name, callback) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window?.webContents || !trusted(event.senderFrame?.url)) return { ok: false, error: 'Unzulässiger Zugriff.' };
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.message || 'Aktion fehlgeschlagen.' }; }
  });
}
function registerHandlers() {
  handle('settings:get', () => ({ ...store.publicState(), platform: process.platform, version: app.getVersion() }));
  handle('settings:save', value => {
    const next = sanitizeSettings(value);
    const monitorKeys = ['monitorEnabled', 'monitorDeviceId', 'monitorVolume'];
    if ((capture || connecting || directSession || speech) && Object.keys(next).some(key => !monitorKeys.includes(key) && next[key] !== store.data[key])) throw new Error('Bitte zuerst das Mikrofon stoppen.');
    return store.saveSettings(next);
  });
  handle('key:save', async ({ key, remember }) => { stopAll(); return store.saveKey(key, !!remember); });
  handle('key:forget', async () => { stopAll(); return store.forgetKey(); });
  handle('account:connect', async () => {
    const voices = await provider.voices();
    let account = null, accountError = '';
    try { account = await provider.account(); } catch { accountError = 'Kontostand nicht auslesbar. Prüfe ihn im ElevenLabs-Dashboard.'; }
    return { voices, account, accountError };
  });
  handle('capture:start', async () => {
    if (capture || connecting || directSession || speech) throw new Error('Eine Sitzung läuft bereits.');
    if (!store.data.voiceId) throw new Error('Bitte zuerst eine Stimme auswählen.');
    if (store.data.mode === 'direct') {
      provider.headers();
      directSession = { voiceId: store.data.voiceId, limit: store.data.audioLimit, bytes: 0 };
      emit({ type: 'usage', characters: 0, audioSeconds: 0 }); return true;
    }
    characters = 0; sessionLimit = store.data.characterLimit; connecting = true;
    const controller = new AbortController(); captureAbort = controller;
    try {
      const socket = await provider.connect(store.data, event => {
        if (captureAbort !== controller || controller.signal.aborted) return;
        if (event.type === 'error') stopAll();
        emit(event);
      }, controller.signal);
      if (captureAbort !== controller || controller.signal.aborted) { socket.terminate(); throw new Error('Sitzung abgebrochen.'); }
      capture = socket; connecting = false; emit({ type: 'usage', characters }); return true;
    } catch (error) { if (captureAbort === controller) stopCapture(); throw error; }
  });
  handle('capture:stop', () => { stopAll(); return true; });
  ipcMain.on('capture:audio', (event, data) => {
    if (event.sender !== window?.webContents || !trusted(event.senderFrame?.url) || !capture || capture.readyState !== 1) return;
    if (!(data instanceof Uint8Array) || data.byteLength > 32000 || data.byteLength % 2) return;
    if (capture.bufferedAmount > 64000) { stopAll(); emit({ type: 'error', message: 'Audio konnte nicht schnell genug gesendet werden. Sitzung gestoppt, damit kein Rückstand entsteht.' }); return; }
    capture.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(data).toString('base64'), sample_rate: 16000 }));
  });
  handle('speech:start', async ({ text, preview = false }) => {
    if (store.data.mode === 'direct') throw new Error('Im direkten Modus bitte eine Mikrofonaufnahme verwenden.');
    if (speech) throw new Error('Eine Sprachausgabe läuft bereits.');
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new Error('Der Sprachabschnitt ist leer oder zu lang.');
    if (!preview && !capture) throw new Error('Keine aktive Mikrofonsitzung.');
    if (preview && capture) throw new Error('Bitte zuerst das Mikrofon stoppen.');
    const limit = preview ? store.data.characterLimit : sessionLimit;
    if (characters + text.length > limit) { stopAll(); throw new Error('Dein Zeichenlimit für diese Sitzung ist erreicht. In den Einstellungen kannst du es ändern.'); }
    const current = { id: crypto.randomUUID(), abort: new AbortController(), reader: null, reading: false };
    speech = current;
    // Count submitted text even if the response is cancelled; provider may already bill it.
    characters += text.length; emit({ type: 'usage', characters });
    try {
      current.reader = await provider.speech(text, store.data.voiceId, current.abort.signal);
      if (speech !== current || current.abort.signal.aborted) { await current.reader.cancel(); throw new Error('Sprachausgabe abgebrochen.'); }
      return { id: current.id, sampleRate: 24000 };
    } catch (error) { if (speech === current) speech = null; throw error; }
  });
  handle('conversion:start', async data => {
    if (!directSession) throw new Error('Keine aktive Voice-Changer-Sitzung.');
    if (speech) throw new Error('Eine Sprachausgabe läuft bereits.');
    const active = directSession;
    try { active.bytes = conversionBytes(data, active.bytes, active.limit); }
    catch (error) { stopAll(); throw error; }
    const current = { id: crypto.randomUUID(), abort: new AbortController(), reader: null, reading: false };
    speech = current;
    emit({ type: 'usage', characters: 0, audioSeconds: active.bytes / 32000 });
    try {
      current.reader = await provider.convert(data, active.voiceId, current.abort.signal);
      if (speech !== current || directSession !== active || current.abort.signal.aborted) { await current.reader.cancel(); throw new Error('Sprachausgabe abgebrochen.'); }
      return { id: current.id, sampleRate: 24000 };
    } catch (error) { if (speech === current) speech = null; throw error; }
  });
  handle('speech:read', async id => {
    const current = speech;
    if (!current || current.id !== id || !current.reader) throw new Error('Sprachausgabe abgebrochen.');
    if (current.reading) throw new Error('Audio wird bereits gelesen.');
    current.reading = true;
    try {
      const result = await current.reader.read();
      if (speech !== current) throw new Error('Sprachausgabe abgebrochen.');
      if (result.done) speech = null;
      return { done: result.done, data: result.value || new Uint8Array() };
    } finally { current.reading = false; }
  });
  handle('speech:stop', () => { stopSpeech(); return true; });
  handle('linux:setup', async () => {
    if (process.platform !== 'linux') throw new Error('Diese Einrichtung ist für Linux. Unter Windows bitte VB-CABLE installieren.');
    try { return await linuxAudio.ensure(); } catch { throw new Error('Virtuelles Mikrofon konnte nicht angelegt werden. Benötigt werden pactl und PulseAudio oder PipeWire mit pipewire-pulse.'); }
  });
  const links = { cable: 'https://vb-audio.com/Cable/', account: 'https://elevenlabs.io/app/settings/subscription', keys: 'https://elevenlabs.io/app/developers/api-keys', pricing: 'https://elevenlabs.io/pricing/api' };
  handle('link:open', async name => { if (!links[name]) throw new Error('Unbekannter Link.'); await shell.openExternal(links[name]); });
}

app.whenReady().then(async () => {
  store = new SettingsStore(app.getPath('userData'), safeStorage); await store.load();
  provider = new ElevenLabs(() => store.key);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    contents === window?.webContents && trusted(contents.getURL()) && (permission === 'speaker-selection' || (permission === 'media' && !(details.mediaTypes || []).includes('video')))
  ));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window?.webContents && trusted(contents.getURL()) && ['media', 'speaker-selection'].includes(permission));
  registerHandlers();
  window = new BrowserWindow({ width: 1200, height: 900, minWidth: 740, minHeight: 680, backgroundColor: '#111216', autoHideMenuBar: true, title: 'GirlVoice', webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', stopAll);
  window.webContents.on('did-start-loading', stopAll);
  window.on('closed', () => { stopAll(); window = null; });
  await window.loadURL(uiUrl);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  stopAll();
  if (!quitting && linuxAudio.owned.length) { event.preventDefault(); quitting = true; linuxAudio.cleanup().finally(() => app.quit()); }
});
