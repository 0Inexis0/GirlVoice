export function joinPcm(chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export function audible(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let energy = 0;
  for (let i = 0; i < bytes.byteLength; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
  return Math.sqrt(energy / (bytes.byteLength / 2)) >= 0.008;
}
// Local energy gate for 100 ms worklet frames. Keep onset preroll, retain pauses,
// and bound uploads to four seconds even when the speaker never pauses.
export class SpeechSegments {
  constructor(silence = 0.7) { this.silenceFrames = Math.round(silence * 10); this.reset(); }
  reset() { this.pre = []; this.chunks = []; this.quiet = 0; this.voiced = 0; }
  push(bytes, now = performance.now()) {
    const voiced = audible(bytes);
    if (!this.chunks.length && !voiced) { this.pre.push(bytes); if (this.pre.length > 2) this.pre.shift(); return null; }
    if (!this.chunks.length) { this.startedAt = now - 100; this.chunks.push(...this.pre); this.pre = []; }
    this.chunks.push(bytes);
    if (voiced) { this.voiced++; this.quiet = 0; } else this.quiet++;
    if (this.quiet < this.silenceFrames && this.chunks.length < 40) return null;
    const result = this.voiced >= 2 ? { audio: joinPcm(this.chunks), startedAt: this.startedAt } : null;
    this.reset(); return result;
  }
}
