import { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';

export default function Monitoring({ settings, devices, disabled, onChange, onVolume }) {
  const [volume, setVolume] = useState(settings.monitorVolume);
  useEffect(() => setVolume(settings.monitorVolume), [settings.monitorVolume]);
  const main = devices.find(device => device.kind === 'audiooutput' && device.deviceId === settings.outputId);
  const outputs = devices.filter(device => device.kind === 'audiooutput' && device.deviceId && !['communications', 'default', settings.outputId].includes(device.deviceId)
    && !(main?.groupId && main.groupId === device.groupId) && !/cable input|girlvoice[_ ]output/i.test(device.label));
  const saveVolume = () => { if (volume !== settings.monitorVolume) onChange({ monitorVolume: volume }); };
  return <section className="monitor-panel panel" aria-labelledby="monitor-title">
    <div className="monitor-intro"><h2 id="monitor-title"><Headphones size={20} /> Monitoring</h2><p>Deine erzeugte Stimme mithören.</p></div>
    <label className="checkbox monitor-toggle"><input type="checkbox" checked={settings.monitorEnabled} disabled={disabled || (!settings.monitorDeviceId && !settings.monitorEnabled)} onChange={e => onChange({ monitorEnabled: e.target.checked })} /> Mithören</label>
    <label className="monitor-device">Kopfhörer<select aria-label="Kopfhörer" value={settings.monitorDeviceId} disabled={disabled} onChange={e => onChange({ monitorDeviceId: e.target.value, ...(!e.target.value ? { monitorEnabled: false } : {}) })}><option value="">Gerät zum Mithören wählen</option>{outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Ausgabegerät ${index + 1}`}</option>)}{settings.monitorDeviceId && !outputs.some(device => device.deviceId === settings.monitorDeviceId) ? <option value={settings.monitorDeviceId}>Gerät nicht verfügbar</option> : null}</select></label>
    <label className="monitor-volume">Lautstärke <span>{Math.round(volume * 100)} %</span><input type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} disabled={disabled || !settings.monitorEnabled} onChange={e => { const next = Number(e.target.value) / 100; setVolume(next); onVolume(next); }} onPointerUp={saveVolume} onKeyUp={saveVolume} onBlur={saveVolume} /></label>
  </section>;
}
