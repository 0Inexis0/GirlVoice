import { useEffect, useRef, useState } from 'react';
import { AudioLines, Settings, X, Info } from 'lucide-react';
import { api, isDesktop } from './bridge.js';
import { AudioEngine } from './audio/engine.js';
import Studio from './components/Studio.jsx';
import Setup from './components/Setup.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import Monitoring from './components/Monitoring.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [devices, setDevices] = useState([]);
  const [voices, setVoices] = useState([]);
  const [account, setAccount] = useState(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('idle');
  const [working, setWorking] = useState(false);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [level, setLevel] = useState(0);
  const [characters, setCharacters] = useState(0);
  const [audioSeconds, setAudioSeconds] = useState(0);
  const [previewMessage, setPreviewMessage] = useState('');
  const [latency, setLatency] = useState(null);
  const [queue, setQueue] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [partial, setPartial] = useState('');
  const engine = useRef(null);
  const statusRef = useRef(status); statusRef.current = status;
  const stopping = useRef(false);
  const operation = useRef(0);
  const stateRef = useRef(state); stateRef.current = state;
  const saving = useRef(Promise.resolve());
  const monitoringChanges = useRef(Promise.resolve());
  const busy = working || monitorBusy || status !== 'idle';

  async function refreshDevices(ask = false) {
    if (!navigator.mediaDevices) return;
    let stream;
    try {
      if (ask) stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const list = await navigator.mediaDevices.enumerateDevices(); setDevices(list);
      return list;
    } finally { stream?.getTracks().forEach(t => t.stop()); }
  }
  async function connect() {
    setWorking(true); setNotice('');
    try {
      const result = await api.connect(); setVoices(result.voices); setAccount(result.account); setConnected(true);
      if (result.accountError) setNotice(result.accountError);
      if (!result.voices.length) setNotice('Keine Stimmen im Konto verfügbar. Bitte in ElevenLabs eine nutzbare Stimme hinzufügen.');
      else if (!result.voices.some(v => v.id === stateRef.current.settings.voiceId)) await save({ ...stateRef.current.settings, voiceId: result.voices[0].id });
    } catch (error) { setConnected(false); setNotice(error.message); throw error; }
    finally { setWorking(false); }
  }
  async function save(settings) {
    const task = saving.current.catch(() => {}).then(() => api.saveSettings(settings));
    saving.current = task;
    const next = await task;
    const updated = { ...stateRef.current, settings: next }; stateRef.current = updated; setState(updated);
  }
  function checkMonitoring(settings) {
    if (!settings.monitorEnabled) return;
    const main = devices.find(d => d.kind === 'audiooutput' && d.deviceId === settings.outputId);
    const target = devices.find(d => d.kind === 'audiooutput' && d.deviceId === settings.monitorDeviceId);
    if (!target || settings.monitorDeviceId === settings.outputId || (main?.groupId && target.groupId === main.groupId) || /cable input|girlvoice[_ ]output/i.test(target.label)) throw new Error('Bitte eigene Kopfhörer für Monitoring auswählen, getrennt von der Hauptausgabe.');
  }
  async function changeMonitoring(patch) {
    setMonitorBusy(true);
    const task = monitoringChanges.current.catch(() => {}).then(async () => {
      await saving.current.catch(() => {});
      const previous = stateRef.current.settings;
      const next = { ...previous, ...patch };
      checkMonitoring(next);
      try { await engine.current.configureMonitoring(next); await save(next); }
      catch (error) { await engine.current.configureMonitoring(previous).catch(() => {}); throw error; }
    });
    monitoringChanges.current = task;
    try { await task; } catch (error) { setNotice(error.message); }
    finally { if (monitoringChanges.current === task) setMonitorBusy(false); }
  }
  async function stop() {
    if (stopping.current) return;
    ++operation.current; stopping.current = true; setWorking(true); statusRef.current = 'idle';
    try { await engine.current.stop(); } catch (e) { setNotice(e.message); }
    finally { setStatus('idle'); setPartial(''); setLevel(0); setWorking(false); stopping.current = false; }
  }
  const eventHandler = useRef(null);
  eventHandler.current = event => {
    switch (event.type) {
      case 'error': setNotice(event.message); void stop(); break;
      case 'warning': setNotice(event.message); break;
      case 'monitor-error': setNotice(event.message); void changeMonitoring({ monitorEnabled: false }); break;
      case 'level': setLevel(event.value); break;
      case 'latency': setLatency(event.value); break;
      case 'queue': setQueue(event.value); break;
      case 'usage': setCharacters(event.characters || 0); setAudioSeconds(event.audioSeconds || 0); break;
      case 'preview-phase': setPreviewMessage(event.message); break;
      case 'processing': if (statusRef.current !== 'idle' && statusRef.current !== 'preview') setStatus('processing'); break;
      case 'speaking': if (statusRef.current !== 'idle' && statusRef.current !== 'preview') setStatus('speaking'); break;
      case 'listening': if (['speaking', 'processing'].includes(statusRef.current)) setStatus('listening'); break;
      case 'partial': setPartial(event.text); break;
      case 'transcript':
        if (event.text && engine.current.active) { setTranscript(previous => `${previous ? `${previous} ` : ''}${event.text}`.slice(-2000)); setPartial(''); engine.current.enqueue(event.text); }
        break;
    }
  };
  useEffect(() => {
    engine.current = new AudioEngine(api, event => eventHandler.current(event));
    const unsubscribe = api.onEvent(event => eventHandler.current(event));
    api.getSettings().then(data => { stateRef.current = data; setState(data); }).catch(e => setNotice(e.message));
    refreshDevices().catch(() => {});
    const deviceChange = async () => {
      const list = await refreshDevices().catch(() => null);
      if (list && engine.current.active && !list.some(d => d.kind === 'audiooutput' && d.deviceId === stateRef.current.settings.outputId)) { setNotice('Das Ausgabegerät wurde getrennt. Die Sitzung wurde gestoppt.'); await stop(); }
      else if (list && stateRef.current?.settings.monitorEnabled && !list.some(d => d.kind === 'audiooutput' && d.deviceId === stateRef.current.settings.monitorDeviceId)) {
        setNotice('Das Monitoring-Gerät wurde getrennt. Die Hauptausgabe läuft weiter.');
        eventHandler.current({ type: 'monitor-error', message: 'Das Monitoring-Gerät wurde getrennt. Die Hauptausgabe läuft weiter.' });
      }
    };
    navigator.mediaDevices?.addEventListener('devicechange', deviceChange);
    return () => { unsubscribe(); navigator.mediaDevices?.removeEventListener('devicechange', deviceChange); void engine.current.stop(); };
  }, []);

  async function start() {
    setNotice('');
    await monitoringChanges.current.catch(() => {}); await saving.current.catch(() => {});
    if (!isDesktop) { setNotice('Bitte die Desktop-App starten. Hier siehst du nur die Oberfläche.'); return; }
    if (!state.hasKey) { setSettingsOpen(true); return; }
    if (!connected) { try { await connect(); } catch { return; } }
    const current = stateRef.current.settings;
    try { checkMonitoring(current); } catch (error) { setNotice(error.message); return; }
    if (!current.inputId || !current.outputId || !current.voiceId) { setNotice('Bitte Mikrofon, Ausgabe und Stimme auswählen. Der kleine Aktualisieren-Knopf lädt deine Audiogeräte.'); return; }
    const input = devices.find(d => d.deviceId === current.inputId);
    if (/girlvoice|cable output/i.test(input?.label || '')) { setNotice('Bitte dein echtes Mikrofon als Eingang auswählen, damit keine Rückkopplung entsteht.'); return; }
    const currentOperation = ++operation.current;
    setStatus('starting'); statusRef.current = 'starting'; setTranscript(''); setPartial(''); setLatency(null);
    try { await engine.current.start(current); if (operation.current === currentOperation) setStatus('listening'); }
    catch (error) { if (operation.current === currentOperation) { setStatus('idle'); setNotice(error.message); } }
  }
  async function preview() {
    await monitoringChanges.current.catch(() => {}); await saving.current.catch(() => {});
    const current = stateRef.current.settings;
    const input = devices.find(d => d.kind === 'audioinput' && d.deviceId === current.inputId);
    if (current.mode === 'direct' && (!current.inputId || /girlvoice|cable output/i.test(input?.label || ''))) { setNotice('Für den Stimmtest bitte dein echtes Mikrofon auswählen.'); return; }
    const currentOperation = ++operation.current;
    setStatus('preview'); statusRef.current = 'preview'; setNotice(''); setPreviewMessage(current.mode === 'direct' ? 'Mikrofon wird vorbereitet…' : 'Deine Teststimme wird abgespielt.');
    try { checkMonitoring(stateRef.current.settings); await engine.current.preview(stateRef.current.settings); } catch (error) { if (statusRef.current === 'preview') setNotice(error.message); }
    finally { if (operation.current === currentOperation) setStatus('idle'); }
  }
  if (!state) return <main className="loading">GirlVoice wird geladen…{notice ? <p role="alert">{notice}</p> : null}</main>;
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><AudioLines size={32} strokeWidth={2.6} /><span>GirlVoice</span></div><button disabled={busy} onClick={() => setSettingsOpen(true)}><Settings size={18} /> Einstellungen</button></header>
    {!isDesktop ? <div className="preview-banner"><Info size={16} /> Oberflächenvorschau. Mikrofon und ElevenLabs sind in der Desktop-App verfügbar.</div> : null}
    {notice ? <div className="notice app-notice" role="alert"><span>{notice}</span><button className="icon-button" aria-label="Hinweis schließen" onClick={() => setNotice('')}><X size={17} /></button></div> : null}
    <main className="workspace"><Studio mode={state.settings.mode} previewMessage={previewMessage} status={status} level={level} hasKey={state.hasKey} busy={busy} onStart={start} onStop={stop} onClear={async () => { if (status === 'preview') await stop(); else { await engine.current.clearOutput(); setStatus('listening'); } }} transcript={transcript} partial={partial} /><Setup state={state} devices={devices} voices={voices} connected={connected} account={account} busy={busy} onSelect={(field, value) => save({ ...stateRef.current.settings, [field]: value }).catch(e => setNotice(e.message))} onDevices={() => refreshDevices(true).catch(e => setNotice(e.message))} onPreview={preview} onSettings={() => setSettingsOpen(true)} onConnect={() => connect().catch(() => {})} /></main>
    <Monitoring settings={state.settings} devices={devices} disabled={monitorBusy || working || status === 'starting' || !isDesktop} onChange={changeMonitoring} onVolume={value => engine.current.setMonitorVolume(value)} />
    <footer className="statusbar"><span><i className={`status-dot ${['listening', 'speaking', 'processing'].includes(status) ? 'online' : ''}`} />{status === 'idle' ? 'Inaktiv' : status === 'starting' ? 'Verbinde' : status === 'preview' ? 'Stimmtest' : 'Mikrofon aktiv'}</span><div>{queue > 0 ? <span>{queue} in Warteschlange</span> : null}<span>{state.settings.mode === 'direct' ? `${audioSeconds.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s Audio gesendet` : `${characters.toLocaleString('de-DE')} Zeichen`}</span><span title="Gemessen vom erkannten Sprechbeginn bis zur geplanten Audioausgabe, ohne Verzögerung durch Discord. Stimmtest: vom Teststart bis zur Ausgabe.">{latency === null ? 'Noch keine Messung' : `${(latency / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} s bis zur Ausgabe`}</span></div></footer>
    {settingsOpen ? <SettingsDialog state={state} onClose={() => setSettingsOpen(false)} onKey={async value => { const next = { ...stateRef.current, ...value }; stateRef.current = next; setState(next); await connect(); }} onSettings={draft => save({ ...stateRef.current.settings, language: draft.language, silence: draft.silence, characterLimit: draft.characterLimit, audioLimit: draft.audioLimit })} onDevices={() => refreshDevices(true)} onForgot={value => { setState(p => ({ ...p, ...value })); setConnected(false); setAccount(null); setVoices([]); }} /> : null}
  </div>;
}
