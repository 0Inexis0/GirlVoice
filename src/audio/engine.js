import captureUrl from './capture-worklet.js?url';
import { PcmDecoder } from './pcm.js';
import { MonitorOutput } from './monitor.js';
import { SpeechSegments, joinPcm, audible } from './segments.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export class AudioEngine {
  constructor(api, onState) { this.api = api; this.onState = onState; this.generation = 0; this.queue = []; this.sources = new Set(); this.running = false; this.active = false; this.monitor = new MonitorOutput(undefined, message => this.onState({ type: 'monitor-error', message })); }
  async prepareOutput(deviceId, settings = {}) {
    if (!deviceId) throw new Error('Bitte ein Ausgabegerät auswählen.');
    const output = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    this.output = output;
    try {
      if (!output.setSinkId) throw new Error('Diese Laufzeit unterstützt keine Geräteauswahl. Bitte die Desktop-App verwenden.');
      await output.setSinkId(deviceId);
      if (this.output !== output) throw new Error('Start abgebrochen.');
      await output.resume();
      if (this.output !== output) throw new Error('Start abgebrochen.');
      this.playbackBus = output.createGain(); this.playbackBus.connect(output.destination);
      await this.monitor.configure(output, this.playbackBus, settings);
      this.nextTime = output.currentTime;
    } catch (error) {
      if (this.output === output) { this.monitor.stop(); this.playbackBus?.disconnect(); this.playbackBus = null; this.output = null; }
      if (output.state !== 'closed') await output.close();
      throw error;
    }
  }
  async configureMonitoring(settings) { if (this.output && this.playbackBus) await this.monitor.configure(this.output, this.playbackBus, settings); }
  setMonitorVolume(volume) { this.monitor.setVolume(volume); }
  async start(settings) {
    const generation = ++this.generation; this.active = true;
    this.mode = settings.mode; this.segmenter = settings.mode === 'direct' ? new SpeechSegments(settings.silence) : null;
    try {
      await this.prepareOutput(settings.outputId, settings);
      if (!this.active || generation !== this.generation) throw new Error('Start abgebrochen.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.inputId ? { exact: settings.inputId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: settings.mode !== 'direct', autoGainControl: false }, video: false });
      if (!this.active || generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); throw new Error('Start abgebrochen.'); }
      this.stream = stream;
      stream.getAudioTracks()[0].onended = () => { if (this.active) this.onState({ type: 'error', message: 'Das Mikrofon wurde getrennt. Bitte das Gerät prüfen.' }); };
      this.input = new AudioContext({ sampleRate: 16000 });
      await this.input.audioWorklet.addModule(captureUrl);
      if (!this.active || generation !== this.generation) throw new Error('Start abgebrochen.');
      if (this.input.sampleRate !== 16000) throw new Error('16-kHz-Aufnahme wird von dieser Laufzeit nicht unterstützt.');
      this.captureNode = new AudioWorkletNode(this.input, 'girlvoice-capture');
      this.inputSource = this.input.createMediaStreamSource(stream);
      await this.api.startCapture();
      if (!this.active || generation !== this.generation) throw new Error('Start abgebrochen.');
      this.captureNode.port.onmessage = ({ data }) => {
        if (!this.active) return;
        const bytes = new Uint8Array(data.buffer);
        if (this.previewRecording) {
          const recording = this.previewRecording;
          if (!recording.complete) {
            recording.chunks.push(bytes); recording.voiced ||= audible(bytes);
            if (recording.chunks.length >= 50) { recording.complete = true; recording.resolve(); }
          }
        } else if (this.segmenter) {
          const segment = this.segmenter.push(bytes);
          if (segment) this.enqueueJob(segment);
        } else {
          this.api.sendAudio(bytes);
          if (data.peak > 0.025 && !this.speechStartedAt) this.speechStartedAt = performance.now();
        }
        this.onState({ type: 'level', value: data.peak });
      };
      this.inputSource.connect(this.captureNode); this.captureNode.connect(this.input.destination);
      await this.input.resume();
    } catch (error) { if (generation === this.generation) await this.stop(); throw error; }
  }
  enqueue(text) {
    if (!this.active || !text) return;
    this.enqueueJob({ text, startedAt: this.speechStartedAt || performance.now() });
    this.speechStartedAt = null;
  }
  enqueueJob(job) {
    if (!this.active) return;
    if (this.queue.length >= (this.mode === 'direct' ? 2 : 5)) { this.onState({ type: 'error', message: 'Die Sprachausgabe kommt nicht hinterher. Sitzung gestoppt. Bitte kürzere Abschnitte sprechen.' }); return; }
    this.queue.push(job); this.onState({ type: 'queue', value: this.queue.length });
    this.drain();
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      while (this.queue.length && this.active && generation === this.generation) {
        const job = this.queue.shift(); this.onState({ type: 'queue', value: this.queue.length });
        await this.play(job.audio || job.text, false, generation, job.startedAt);
      }
    } catch (error) { if (generation === this.generation) this.onState({ type: 'error', message: error.message }); }
    finally { this.running = false; if (this.queue.length && this.active) this.drain(); }
  }
  async play(text, preview, generation, startedAt) {
    if (generation !== this.generation) return;
    if (text instanceof Uint8Array) this.onState({ type: 'processing' });
    const { id } = text instanceof Uint8Array ? await this.api.startConversion(text) : await this.api.startSpeech(text, preview);
    const decoder = new PcmDecoder(); let first = true;
    try {
      while (generation === this.generation && this.output) {
        // Backpressure: request more PCM only when the playback buffer has room.
        while (this.output && this.nextTime - this.output.currentTime > 1.5 && generation === this.generation) await wait(30);
        if (!this.output || generation !== this.generation) return;
        const { data, done } = await this.api.readSpeech(id);
        if (!this.output || generation !== this.generation) return;
        if (done) break;
        const samples = decoder.decode(data);
        if (!samples.length) continue;
        const buffer = this.output.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
        const source = this.output.createBufferSource(); source.buffer = buffer; source.connect(this.playbackBus);
        const at = Math.max(this.nextTime, this.output.currentTime + 0.04);
        source.start(at); this.nextTime = at + buffer.duration; this.sources.add(source);
        source.onended = () => {
          source.disconnect(); this.sources.delete(source);
          if (generation === this.generation && !this.sources.size && !this.running && !this.queue.length) this.onState({ type: 'listening' });
        };
        if (first) { first = false; this.onState({ type: 'latency', value: Math.round(performance.now() - startedAt + (at - this.output.currentTime) * 1000) }); }
        this.onState({ type: 'speaking' });
      }
      if (first && generation === this.generation) throw new Error('ElevenLabs hat kein abspielbares Audio geliefert.');
      // Direct speech has roughly the same duration as its input. Overlap the next
      // conversion with scheduled playback so network latency does not add up per turn.
      if (!(text instanceof Uint8Array) || preview) while (this.output && this.output.currentTime < this.nextTime && generation === this.generation) await wait(30);
    } finally { if (generation === this.generation && !this.sources.size) this.onState({ type: 'listening' }); }
  }
  async preview(settings) {
    if (settings.mode === 'direct') return this.previewDirect(settings);
    const generation = ++this.generation;
    try { await this.prepareOutput(settings.outputId, settings); await this.play('Hey, schön dich zu hören. Das ist meine neue Stimme.', true, generation, performance.now()); }
    finally { if (generation === this.generation) await this.stop(); }
  }
  async previewDirect(settings) {
    const generation = this.generation + 1;
    let recording;
    const ready = new Promise((resolve, reject) => { recording = { resolve, reject, chunks: [], voiced: false, complete: false }; });
    ready.catch(() => {});
    this.previewRecording = recording;
    try {
      await this.start(settings);
      if (generation !== this.generation) return;
      this.onState({ type: 'preview-phase', message: 'Sprich jetzt einen Satz. Aufnahme: 5 Sekunden.' });
      recording.timer = setTimeout(() => recording.reject(new Error('Die Aufnahme liefert kein Audio. Bitte Mikrofon prüfen.')), 8000);
      await ready; clearTimeout(recording.timer);
      await this.releaseInput();
      if (generation !== this.generation) return;
      this.previewRecording = null;
      if (!recording.voiced) throw new Error('Keine Sprache erkannt. Sprich näher am Mikrofon und starte den Test erneut.');
      this.onState({ type: 'preview-phase', message: 'Deine Aufnahme wird umgewandelt und abgespielt.' });
      await this.play(joinPcm(recording.chunks), true, generation, performance.now());
    } finally {
      clearTimeout(recording.timer);
      if (generation === this.generation) await this.stop();
    }
  }
  async clearOutput() {
    ++this.generation; this.queue = []; this.speechStartedAt = null;
    this.segmenter?.reset();
    for (const source of this.sources) { try { source.stop(); source.disconnect(); } catch {} }
    this.sources.clear(); if (this.output) this.nextTime = this.output.currentTime;
    this.onState({ type: 'queue', value: 0 });
    await this.api.stopSpeech();
  }
  async releaseInput() {
    if (this.captureNode) this.captureNode.port.onmessage = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    this.inputSource?.disconnect(); this.captureNode?.disconnect(); this.captureNode = null; this.inputSource = null;
    const input = this.input; this.input = null; if (input && input.state !== 'closed') await input.close();
  }
  async stop() {
    this.active = false; ++this.generation;
    const recording = this.previewRecording; this.previewRecording = null;
    if (recording) { clearTimeout(recording.timer); recording.reject(new Error('Aufnahme abgebrochen.')); }
    await this.releaseInput();
    await this.clearOutput();
    this.monitor.stop(); this.playbackBus?.disconnect(); this.playbackBus = null;
    const output = this.output; this.output = null; if (output && output.state !== 'closed') await output.close();
    await this.api.stopCapture();
    this.onState({ type: 'level', value: 0 });
  }
}
