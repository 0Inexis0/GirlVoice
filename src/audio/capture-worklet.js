class CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(1600); this.offset = 0; this.peak = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const raw of channel) {
      const sample = Math.max(-1, Math.min(1, raw));
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.buffer[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ buffer: this.buffer.buffer, peak: this.peak }, [this.buffer.buffer]);
        this.buffer = new Int16Array(1600); this.offset = 0; this.peak = 0;
      }
    }
    return true; // Outputs remain silent. Original microphone never reaches speakers.
  }
}
registerProcessor('girlvoice-capture', CaptureProcessor);
