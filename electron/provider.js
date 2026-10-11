import WebSocket from 'ws';

export function providerError(status, code = '') {
  if (/quota|credit|insufficient|payment/.test(code) || status === 402) return 'ElevenLabs-Kontingent aufgebraucht. Prüfe dein Guthaben im ElevenLabs-Konto.';
  if (/unaccepted_terms/.test(code)) return 'Bitte die Bedingungen für Spracherkennung im ElevenLabs-Dashboard akzeptieren.';
  if (status === 401 || /auth|invalid_api_key/.test(code)) return 'ElevenLabs hat den API-Key abgelehnt. Bitte den Key prüfen.';
  if (status === 403 || /permission|subscription|paid|voice_not_found/.test(code)) return 'Für diese Funktion oder Stimme fehlen API-Rechte oder der passende Tarif. Wähle eine andere Stimme und prüfe die Key-Berechtigungen.';
  if (status === 429 || /rate|throttled|resource_exhausted/.test(code)) return 'ElevenLabs-Nutzungslimit erreicht. Die Sitzung wurde gestoppt. Bitte später erneut starten.';
  return 'ElevenLabs-Anfrage fehlgeschlagen. Prüfe Verbindung, Stimme und Tarif und starte erneut.';
}
export function parseScribeEvent(data) {
  const event = typeof data === 'string' ? JSON.parse(data) : data;
  if (event.message_type === 'partial_transcript') return { type: 'partial', text: String(event.text || '') };
  if (event.message_type === 'committed_transcript') return { type: 'transcript', text: String(event.text || '').trim() };
  if (event.message_type === 'session_started') return { type: 'ready' };
  if (event.message_type === 'warning') return { type: 'warning', message: 'ElevenLabs meldet eine Einschränkung der Sitzung. Prüfe die Kontoeinstellungen.' };
  if (event.error || /error|quota|rate_limited|resource_exhausted|session_time_limit|insufficient_audio|queue_overflow|transcriber/.test(event.message_type || '')) return { type: 'error', message: providerError(0, event.message_type) };
  return null; // Never re-speak timestamp or edited transcript variants.
}
export class ElevenLabs {
  constructor(getKey, { fetchImpl = fetch, socketFactory = (url, options) => new WebSocket(url, options) } = {}) {
    this.getKey = getKey; this.fetch = fetchImpl; this.socketFactory = socketFactory;
  }
  headers() { const key = this.getKey(); if (!key) throw new Error('Bitte zuerst deinen ElevenLabs API-Key hinterlegen.'); return { 'xi-api-key': key }; }
  async request(route, options = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(15000);
    let response;
    try { response = await this.fetch(`https://api.elevenlabs.io${route}`, { ...options, signal, headers: { ...this.headers(), ...options.headers } }); }
    catch (error) { if (options.signal?.aborted) throw error; throw new Error('ElevenLabs ist nicht erreichbar oder antwortet zu langsam. Prüfe deine Internetverbindung.'); }
    if (!response.ok) {
      let code = ''; try { const body = await response.json(); code = body.detail?.status || ''; } catch {}
      throw new Error(providerError(response.status, code));
    }
    return response;
  }
  async voices() {
    const voices = []; let next = '';
    do {
      const page = await (await this.request(`/v2/voices?page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`)).json();
      voices.push(...(page.voices || []).map(v => ({ id: v.voice_id, name: v.name, gender: v.labels?.gender || '', category: v.category || '', language: v.labels?.language || '' })));
      next = page.has_more ? page.next_page_token : '';
    } while (next);
    return voices.sort((a, b) => Number(b.gender === 'female') - Number(a.gender === 'female') || a.name.localeCompare(b.name));
  }
  async account() {
    const data = await (await this.request('/v1/user/subscription')).json();
    return { tier: data.tier || 'Unbekannt', used: data.character_count ?? null, limit: data.character_limit ?? null, resetAt: data.next_character_count_reset_unix ?? null };
  }
  async speech(text, voiceId, signal) {
    if (!/^[\w-]{1,128}$/.test(voiceId)) throw new Error('Bitte eine Stimme auswählen.');
    const response = await this.request(`/v1/text-to-speech/${voiceId}/stream?output_format=pcm_24000`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: false } })
    });
    return response.body.getReader();
  }
  async convert(audio, voiceId, signal) {
    if (!/^[\w-]{1,128}$/.test(voiceId)) throw new Error('Bitte eine Stimme auswählen.');
    const body = new FormData();
    body.append('audio', new Blob([audio], { type: 'application/octet-stream' }), 'speech.pcm');
    body.append('model_id', 'eleven_multilingual_sts_v2');
    body.append('file_format', 'pcm_s16le_16');
    body.append('remove_background_noise', 'false');
    body.append('voice_settings', JSON.stringify({ stability: 0.35, similarity_boost: 0.75, style: 0, use_speaker_boost: false }));
    const response = await this.request(`/v1/speech-to-speech/${voiceId}/stream?output_format=pcm_24000`, { method: 'POST', signal, body });
    return response.body.getReader();
  }
  connect(settings, emit, signal) {
    return new Promise((resolve, reject) => {
      const query = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'vad', vad_silence_threshold_secs: String(settings.silence) });
      if (settings.language !== 'auto') query.set('language_code', settings.language);
      const ws = this.socketFactory(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`, { headers: this.headers(), handshakeTimeout: 15000 });
      let ready = false, settled = false;
      const fail = message => { clearTimeout(timer); const wasReady = ready; ready = false; if (!settled) { settled = true; reject(new Error(message)); } else if (wasReady && !signal.aborted) emit({ type: 'error', message }); ws.terminate(); };
      const timer = setTimeout(() => fail('Spracherkennung antwortet nicht. Bitte erneut versuchen.'), 15000);
      const abort = () => { clearTimeout(timer); ready = false; ws.terminate(); if (!settled) { settled = true; reject(new Error('Verbindung abgebrochen.')); } };
      signal.addEventListener('abort', abort, { once: true });
      ws.on('message', raw => {
        try {
          const event = parseScribeEvent(raw.toString());
          if (event?.type === 'ready') { clearTimeout(timer); ready = true; if (!settled) { settled = true; resolve(ws); } }
          else if (event?.type === 'error') fail(event.message);
          else if (event && ready && !signal.aborted) emit(event);
        } catch { fail('Ungültige Antwort der Spracherkennung.'); }
      });
      ws.on('error', () => { if (!signal.aborted) fail('Spracherkennung konnte nicht verbunden werden. Prüfe Internet, API-Rechte und Kontingent.'); });
      ws.on('close', () => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (!signal.aborted) { if (!settled) { settled = true; reject(new Error('Spracherkennung hat die Verbindung geschlossen.')); } else if (ready) { ready = false; emit({ type: 'error', message: 'Spracherkennung getrennt. Bitte erneut starten.' }); } } });
      if (signal.aborted) abort();
    });
  }
}
