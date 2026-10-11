import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export class LinuxAudio {
  constructor(run = async args => (await execute('pactl', args, { timeout: 8000, maxBuffer: 1024 * 1024 })).stdout) { this.run = run; this.owned = []; }
  async ensure() {
    const sinks = await this.run(['list', 'short', 'sinks']);
    const sources = await this.run(['list', 'short', 'sources']);
    const created = [];
    try {
      if (!sinks.split('\n').some(l => l.split('\t')[1] === 'girlvoice_sink')) created.push((await this.run(['load-module', 'module-null-sink', 'sink_name=girlvoice_sink', 'rate=48000', 'channels=2', 'sink_properties=device.description=GirlVoice_Output'])).trim());
      if (!sources.split('\n').some(l => l.split('\t')[1] === 'girlvoice_mic')) created.push((await this.run(['load-module', 'module-remap-source', 'master=girlvoice_sink.monitor', 'source_name=girlvoice_mic', 'source_properties=device.description=GirlVoice_Microphone'])).trim());
      this.owned.push(...created.filter(id => /^\d+$/.test(id)));
      return 'Virtuelles Mikrofon bereit. Als Ausgabe GirlVoice_Output und in Discord GirlVoice_Microphone wählen.';
    } catch (e) { for (const id of created.reverse()) if (/^\d+$/.test(id)) await this.run(['unload-module', id]).catch(() => {}); throw e; }
  }
  async cleanup() { for (const id of this.owned.reverse()) await this.run(['unload-module', id]).catch(() => {}); this.owned = []; }
}
