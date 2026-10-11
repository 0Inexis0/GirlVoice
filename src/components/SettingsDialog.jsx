import { useEffect, useRef, useState } from 'react';
import { X, KeyRound, ExternalLink, AudioLines, ShieldCheck, Trash2 } from 'lucide-react';
import { api, isDesktop } from '../bridge.js';

export default function SettingsDialog({ state, onClose, onKey, onSettings, onDevices, onForgot }) {
  const dialog = useRef(null);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(state.secureStorage);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(state.settings);
  useEffect(() => { dialog.current.showModal(); return () => dialog.current?.close(); }, []);
  async function run(action) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const change = (name, value) => setDraft(previous => ({ ...previous, [name]: value }));
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="settings-title">Einstellungen</h2><button className="icon-button" aria-label="Einstellungen schließen" disabled={busy} onClick={onClose}><X size={21} /></button></div>
    <div className="dialog-content">
      <section>
        <h3><KeyRound size={18} /> ElevenLabs verbinden</h3>
        <p>Sprache und Text werden zur Verarbeitung an ElevenLabs gesendet. GirlVoice speichert keine Aufnahmen oder Transkripte auf der Festplatte.</p>
        <form onSubmit={e => { e.preventDefault(); run(async () => { const next = await api.saveKey(key, remember); setKey(''); await onKey(next); setMessage('API-Key hinterlegt.'); }); }}>
          <label htmlFor="api-key">API-Key</label>
          <input id="api-key" type="password" autoComplete="off" spellCheck="false" value={key} onChange={e => setKey(e.target.value)} placeholder={state.hasKey ? 'Key hinterlegt. Neuen Key zum Ersetzen eingeben.' : 'Deinen ElevenLabs API-Key einfügen'} disabled={busy || !isDesktop} />
          <label className="checkbox"><input type="checkbox" checked={remember} disabled={!state.secureStorage || busy} onChange={e => setRemember(e.target.checked)} /> Im System-Schlüsselbund speichern</label>
          <p className="hint"><ShieldCheck size={15} />{state.secureStorage ? 'Verschlüsselt für dein Benutzerkonto. Der Key wird nie angezeigt.' : 'Kein sicherer Schlüsselbund verfügbar. Der Key gilt nur für diese Sitzung.'}</p>
          <div className="button-row"><button className="primary" disabled={busy || !key.trim() || !isDesktop}>Speichern &amp; verbinden</button><button type="button" className="text-button" onClick={() => run(() => api.openLink('keys'))}>API-Keys öffnen <ExternalLink size={14} /></button></div>
          {state.hasKey ? <button type="button" className="text-button danger" disabled={busy} onClick={() => run(async () => { onForgot(await api.forgetKey()); setMessage('API-Key entfernt.'); })}><Trash2 size={14} /> Gespeicherten Key entfernen</button> : null}
        </form>
      </section>
      <section>
        <h3><AudioLines size={18} /> Virtuelles Mikrofon</h3>
        {state.platform === 'linux' ? <><p>Für PipeWire mit PulseAudio-Unterstützung oder PulseAudio. In GirlVoice „GirlVoice_Output“ auswählen, in Discord „GirlVoice_Microphone“. Die Geräte gelten, solange GirlVoice geöffnet ist.</p><button disabled={busy} onClick={() => run(async () => { setMessage(await api.setupLinux()); await onDevices(); })}>Virtuelles Mikrofon einrichten</button></> : <><p>VB-CABLE installieren. In GirlVoice „CABLE Input“ als Ausgabe auswählen, in Discord oder im Spiel „CABLE Output“ als Mikrofon. Zum Vorhören kannst du stattdessen deine Kopfhörer wählen.</p><button onClick={() => run(() => api.openLink('cable'))}>VB-CABLE herunterladen <ExternalLink size={15} /></button></>}
      </section>
      <section>
        <h3>Sprache &amp; Verbrauch</h3>
        <div className="settings-grid"><label>Sprache für Textmodus<select disabled={draft.mode === 'direct'} value={draft.language} onChange={e => change('language', e.target.value)}><option value="de">Deutsch</option><option value="en">Englisch</option><option value="auto">Automatisch</option></select></label><label>Sprechpause bis zur Ausgabe<select value={draft.silence} onChange={e => change('silence', Number(e.target.value))}><option value="0.5">0,5 Sekunden</option><option value="0.7">0,7 Sekunden</option><option value="1">1 Sekunde</option><option value="1.5">1,5 Sekunden</option></select></label></div>
        <label>Maximale Audiosekunden pro direkter Sitzung<input aria-label="Maximale Audiosekunden" type="number" min="10" max="3600" step="10" value={draft.audioLimit} onChange={e => change('audioLimit', Number(e.target.value))} /></label>
        <label>Maximale TTS-Zeichen pro Sitzung<input type="number" min="100" max="100000" step="100" value={draft.characterLimit} onChange={e => change('characterLimit', Number(e.target.value))} /></label>
        <p className="hint">Lokale Limits, keine Garantie für kostenlose Nutzung. Der direkte Modus zählt gesendete Audiosekunden einschließlich Pausen und abgebrochener Anfragen. Jeder Start und Aufnahmetest beginnt eine neue Sitzung. Nur der Textmodus nutzt Spracherkennung und TTS. Guthaben und mögliche Zusatzkosten gelten laut deinem ElevenLabs-Tarif.</p>
        <div className="button-row"><button disabled={busy || !isDesktop || draft.characterLimit < 100 || draft.characterLimit > 100000 || !Number.isInteger(draft.audioLimit) || draft.audioLimit < 10 || draft.audioLimit > 3600} onClick={() => run(async () => { await onSettings(draft); setMessage('Einstellungen gespeichert.'); })}>Einstellungen speichern</button><button className="text-button" onClick={() => run(() => api.openLink('account'))}>Guthaben prüfen <ExternalLink size={14} /></button></div>
      </section>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {message ? <div className="notice success" role="status">{message}</div> : null}
    </div>
    <div className="dialog-footer">GirlVoice {state.version} <span>Windows &amp; Linux</span></div>
  </dialog>;
}
