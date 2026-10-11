const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, value) => {
  const response = await ipcRenderer.invoke(name, value);
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
contextBridge.exposeInMainWorld('girlvoice', {
  getSettings: () => invoke('settings:get'),
  saveSettings: value => invoke('settings:save', value),
  saveKey: (key, remember) => invoke('key:save', { key, remember }),
  forgetKey: () => invoke('key:forget'),
  connect: () => invoke('account:connect'),
  startCapture: () => invoke('capture:start'),
  stopCapture: () => invoke('capture:stop'),
  sendAudio: data => ipcRenderer.send('capture:audio', data),
  startSpeech: (text, preview) => invoke('speech:start', { text, preview }),
  startConversion: data => invoke('conversion:start', data),
  readSpeech: id => invoke('speech:read', id),
  stopSpeech: () => invoke('speech:stop'),
  setupLinux: () => invoke('linux:setup'),
  openLink: name => invoke('link:open', name),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('voice:event', listener); return () => ipcRenderer.removeListener('voice:event', listener); }
});
