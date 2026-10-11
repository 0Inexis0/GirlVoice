const defaults = { inputId: '', outputId: '', voiceId: '', mode: 'direct', audioLimit: 180, language: 'de', silence: 0.7, characterLimit: 3000, monitorEnabled: false, monitorDeviceId: '', monitorVolume: 0.5 };
const desktopOnly = async () => { throw new Error('Bitte GirlVoice als Desktop-App starten. Die Browseransicht ist nur eine Vorschau.'); };
export const isDesktop = !!window.girlvoice;
export const api = window.girlvoice || {
  getSettings: async () => ({ settings: defaults, hasKey: false, secureStorage: false, platform: 'preview', version: '0.1.0' }),
  saveSettings: desktopOnly, saveKey: desktopOnly, forgetKey: desktopOnly, connect: desktopOnly,
  startCapture: desktopOnly, stopCapture: async () => {}, sendAudio: () => {},
  startSpeech: desktopOnly, startConversion: desktopOnly, readSpeech: desktopOnly, stopSpeech: async () => {},
  setupLinux: desktopOnly, openLink: desktopOnly, onEvent: () => () => {}
};
