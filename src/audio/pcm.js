// A HTTP chunk may end between the two bytes of a PCM16 sample.
export class PcmDecoder {
  constructor() { this.pending = null; }
  decode(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const length = input.length + (this.pending === null ? 0 : 1);
    const joined = new Uint8Array(length);
    let start = 0;
    if (this.pending !== null) { joined[0] = this.pending; start = 1; }
    joined.set(input, start);
    this.pending = length % 2 ? joined[length - 1] : null;
    const result = new Float32Array(Math.floor(length / 2));
    const view = new DataView(joined.buffer);
    for (let i = 0; i < result.length; i++) result[i] = view.getInt16(i * 2, true) / 32768;
    return result;
  }
}
