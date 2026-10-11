export function monitorVolume(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

// The same decoded TTS audio feeds a local second output. No extra API request.
export class MonitorOutput {
  constructor(createAudio = () => new Audio(), onError = () => {}) {
    this.createAudio = createAudio; this.onError = onError; this.revision = 0; this.route = null;
  }
  dispose(route) {
    if (!route) return;
    route.audio.onerror = null;
    route.audio.pause(); route.audio.srcObject = null;
    try { route.bus.disconnect(route.gain); } catch {}
    route.gain.disconnect();
    route.destination.stream.getTracks().forEach(track => track.stop());
  }
  stop() { ++this.revision; this.dispose(this.route); this.route = null; }
  setVolume(volume) { if (this.route) this.route.gain.gain.setTargetAtTime(monitorVolume(volume), this.route.context.currentTime, 0.01); }
  async configure(context, bus, settings) {
    const revision = ++this.revision;
    if (!settings.monitorEnabled) { this.dispose(this.route); this.route = null; return; }
    if (!settings.monitorDeviceId) throw new Error('Bitte ein Kopfhörergerät für Monitoring auswählen.');
    if (settings.monitorDeviceId === settings.outputId) throw new Error('Monitoring braucht ein anderes Gerät als die Hauptausgabe. Wähle deine Kopfhörer.');
    if (this.route?.deviceId === settings.monitorDeviceId && this.route.context === context) { this.setVolume(settings.monitorVolume); return; }
    const audio = this.createAudio();
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain();
    const candidate = { audio, destination, gain, bus, context, deviceId: settings.monitorDeviceId };
    gain.gain.value = monitorVolume(settings.monitorVolume); gain.connect(destination);
    audio.srcObject = destination.stream;
    try {
      if (!audio.setSinkId) throw new Error('Monitoring wird von dieser Laufzeit nicht unterstützt.');
      await audio.setSinkId(settings.monitorDeviceId);
      if (revision !== this.revision) { this.dispose(candidate); return; }
      await audio.play();
      if (revision !== this.revision) { this.dispose(candidate); return; }
      this.dispose(this.route); this.route = candidate; bus.connect(gain);
      audio.onerror = () => {
        if (this.route !== candidate) return;
        this.stop(); this.onError('Monitoring wurde getrennt. Die Hauptausgabe läuft weiter.');
      };
    } catch (error) {
      this.dispose(candidate);
      if (revision === this.revision) throw new Error(`Monitoring konnte nicht gestartet werden: ${error.message}`);
    }
  }
}
