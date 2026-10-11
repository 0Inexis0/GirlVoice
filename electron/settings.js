import { promises as fs } from 'node:fs';
import path from 'node:path';

export const defaults = { inputId: '', outputId: '', voiceId: '', mode: 'direct', audioLimit: 180, language: 'de', silence: 0.7, characterLimit: 3000, monitorEnabled: false, monitorDeviceId: '', monitorVolume: 0.5 };
export function sanitizeSettings(value = {}) {
  const next = { ...defaults };
  if (['direct', 'text'].includes(value.mode)) next.mode = value.mode;
  if (Number.isInteger(value.audioLimit) && value.audioLimit >= 10 && value.audioLimit <= 3600) next.audioLimit = value.audioLimit;
  for (const key of ['inputId', 'outputId', 'voiceId', 'monitorDeviceId']) if (typeof value[key] === 'string') next[key] = value[key].slice(0, 512);
  if (typeof value.monitorEnabled === 'boolean') next.monitorEnabled = value.monitorEnabled;
  if (Number.isFinite(value.monitorVolume)) next.monitorVolume = Math.max(0, Math.min(1, value.monitorVolume));
  if (['de', 'en', 'auto'].includes(value.language)) next.language = value.language;
  if ([0.5, 0.7, 1, 1.5].includes(value.silence)) next.silence = value.silence;
  if (Number.isInteger(value.characterLimit) && value.characterLimit >= 100 && value.characterLimit <= 100000) next.characterLimit = value.characterLimit;
  return next;
}
export class SettingsStore {
  constructor(directory, encryption) { this.directory = directory; this.encryption = encryption; this.data = defaults; this.key = ''; this.writes = Promise.resolve(); }
  canEncrypt() {
    return this.encryption.isEncryptionAvailable() && this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }
  async load() {
    try { this.data = sanitizeSettings(JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8'))); } catch {}
    try { if (this.canEncrypt()) this.key = this.encryption.decryptString(await fs.readFile(path.join(this.directory, 'credential.bin'))); } catch {}
    return this.publicState();
  }
  publicState() { return { settings: this.data, hasKey: !!this.key, secureStorage: this.canEncrypt() }; }
  async atomicWrite(name, data) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, name);
    await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
  async saveSettings(value) {
    const next = sanitizeSettings(value);
    const write = this.writes.catch(() => {}).then(async () => { await this.atomicWrite('settings.json', JSON.stringify(next, null, 2)); this.data = next; return next; });
    this.writes = write;
    return write;
  }
  async saveKey(key, remember) {
    if (typeof key !== 'string' || !key.trim() || key.length > 512 || /[\r\n]/.test(key)) throw new Error('Bitte einen gültigen API-Key eingeben.');
    if (remember && !this.canEncrypt()) throw new Error('Kein sicherer Schlüsselbund verfügbar. Verwende den Key nur für diese Sitzung.');
    if (remember) await this.atomicWrite('credential.bin', this.encryption.encryptString(key.trim()));
    else await fs.rm(path.join(this.directory, 'credential.bin'), { force: true });
    this.key = key.trim();
    return this.publicState();
  }
  async forgetKey() { await fs.rm(path.join(this.directory, 'credential.bin'), { force: true }); this.key = ''; return this.publicState(); }
}
