import { Info, Play, RefreshCw } from 'lucide-react';
export default function Setup({ state, devices, voices, connected, account, busy, onSelect, onDevices, onPreview, onSettings, onConnect }) {
  const { settings } = state;
  const options = (kind) => devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'communications');
  const dropdown = (label, field, kind, placeholder) => <label>{label}<select value={settings[field]} disabled={busy} onChange={e => onSelect(field, e.target.value)}><option value="">{placeholder}</option>{options(kind).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}</select></label>;
  return <aside className="setup panel"><div className="section-heading"><h2>Dein Setup</h2><button className="icon-button" aria-label="Audiogeräte aktualisieren" title="Audiogeräte aktualisieren" disabled={busy} onClick={onDevices}><RefreshCw size={17} /></button></div>
    <div className="setup-fields"><label>Modus<select aria-label="Modus" value={settings.mode} disabled={busy} onChange={e => onSelect('mode', e.target.value)}><option value="direct">Direkter Voice Changer</option><option value="text">Sprache → Text → Stimme</option></select></label>
      {dropdown('Mikrofon', 'inputId', 'audioinput', 'Gerät auswählen')}
      {dropdown('Ausgabe', 'outputId', 'audiooutput', 'Virtuelles Mikrofon wählen')}
      <label>Stimme<select value={settings.voiceId} disabled={busy || !voices.length} onChange={e => onSelect('voiceId', e.target.value)}><option value="">{connected ? 'Stimme auswählen' : 'Zuerst verbinden'}</option>{voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.gender === 'female' ? ' · weiblich' : ''}</option>)}</select></label>
    </div>
    <p className="model-info"><Info size={17} /> {settings.mode === 'direct' ? 'Voice Changer · Multilingual v2' : `Flash v2.5 · ${settings.language === 'de' ? 'Deutsch' : settings.language === 'en' ? 'Englisch' : 'Automatisch'}`}</p>
    <button className="primary full" disabled={busy || !connected || !settings.voiceId || !settings.outputId || (settings.mode === 'direct' && !settings.inputId)} onClick={onPreview}><Play size={18} fill="currentColor" />{settings.mode === 'direct' ? '5 Sekunden aufnehmen & testen' : 'Stimme testen'}</button>
    <section className="connection"><h3>ElevenLabs</h3><div className="connection-status"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Verbunden' : 'Nicht verbunden'}</div>
      {account ? <p className="account-info">Tarif: {account.tier}{Number.isFinite(account.limit) && Number.isFinite(account.used) ? <><br />{Math.max(0, account.limit - account.used).toLocaleString('de-DE')} von {account.limit.toLocaleString('de-DE')} Kontingent-Einheiten übrig</> : null}<br /><span>Stand der letzten Abfrage</span></p> : null}
      <button className="full" disabled={busy} onClick={state.hasKey ? onConnect : onSettings}>{state.hasKey ? 'Verbindung aktualisieren' : 'API-Key hinterlegen'}</button>
    </section>
  </aside>;
}
