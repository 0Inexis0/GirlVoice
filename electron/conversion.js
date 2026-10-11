// 16-bit mono PCM at 16 kHz. Count submitted bytes, including cancelled requests.
export function conversionBytes(data, used, limitSeconds) {
  if (!(data instanceof Uint8Array) || data.byteLength < 3200 || data.byteLength > 192000 || data.byteLength % 2) throw new Error('Ungültiger Audioabschnitt. Erlaubt sind 0,1 bis 6 Sekunden PCM-Audio.');
  if (used + data.byteLength > limitSeconds * 32000) throw new Error('Dein Audiolimit für diese Sitzung ist erreicht. In den Einstellungen kannst du es ändern.');
  return used + data.byteLength;
}
