import { Mic, Square, AudioLines } from 'lucide-react';

export default function Studio({ mode, previewMessage, status, level, hasKey, busy, onStart, onStop, onClear, transcript, partial }) {
  const active = ['listening', 'speaking', 'processing'].includes(status);
  const meterActive = active || status === 'preview';
  const title = status === 'processing' ? 'Deine Stimme wird umgewandelt.' : status === 'speaking' ? 'Deine Stimme ist unterwegs.' : status === 'listening' ? 'Ich höre dir zu.' : status === 'starting' ? 'Verbindung wird aufgebaut.' : status === 'preview' ? 'Deine neue Stimme.' : 'Bereit, wenn du es bist.';
  return <div className="studio-column">
    <section className="studio panel" aria-labelledby="studio-title">
      <h1 id="studio-title">Deine Stimme. Dein Sound.</h1>
      <p className="subtitle">Sprich ganz normal. Wähle, wie du klingst.</p>
      <div className={`mic-orb ${meterActive ? 'active' : ''}`}><Mic size={61} strokeWidth={1.8} /></div>
      <div className="meter" aria-label={`Mikrofonpegel ${Math.round(level * 100)} Prozent`}>
        {Array.from({ length: 29 }, (_, i) => <i key={i} style={{ height: `${meterActive ? 8 + Math.min(level * 3, 1) * (12 + (1 - Math.abs(i - 14) / 14) * 28) : 8}px`, backgroundColor: meterActive && level > 0.01 ? 'var(--accent)' : undefined }} />)}
      </div>
      <h2 className="studio-state" aria-live="polite">{title}</h2>
      <p className="studio-help">{status === 'preview' ? previewMessage : active ? 'Kurze Sprechpausen geben deiner Stimme Raum.' : hasKey ? 'Wähle deine Geräte und deine Stimme.' : 'Verbinde ElevenLabs, um loszulegen.'}</p>
      <div className="studio-actions">
        <button className="primary" disabled={busy && !active} onClick={active ? onStop : onStart}>{active ? <Square size={18} fill="currentColor" /> : <Mic size={21} />}{active ? 'Mikrofon stoppen' : status === 'starting' ? 'Verbinde…' : 'Mikrofon starten'}</button>
        <button disabled={!active && status !== 'preview'} onClick={onClear}><Square size={16} fill="currentColor" /> Ausgabe stoppen</button>
      </div>
    </section>
    <section className="transcript panel"><div className="section-heading"><h2>{mode === 'direct' ? 'Direkte Sprachumwandlung' : 'Live-Transkript'}</h2><AudioLines size={18} /></div><div className="transcript-content" aria-live="polite">{mode === 'direct' ? <p className="muted">Deine Stimme wird direkt umgewandelt. Audioabschnitte werden nach Sprechpausen gesendet, spätestens nach 4 Sekunden. Ohne Text-Zwischenschritt oder Transkript.</p> : <><p>{transcript || (!partial ? <span className="muted">Deine gesprochenen Worte erscheinen hier.</span> : '')}</p>{partial ? <p className="partial">{partial}</p> : null}</>}</div></section>
  </div>;
}
