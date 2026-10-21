const { contextBridge, ipcRenderer } = require('electron');

// umbra:// sayfalarına açılan dar köprü; ana süreç her çağrıda gönderenin bir iç sayfa sekmesi olduğunu doğrular
contextBridge.exposeInMainWorld('ic', {
  veri: (sayfa, arama) => ipcRenderer.invoke('ic:veri', String(sayfa), String(arama || '')),
  eylem: (eylem, ...arg) => ipcRenderer.invoke('ic:eylem', String(eylem), ...arg),
  degisinceDinle: (cb) => ipcRenderer.on('ic:degisti', (_e, sayfa) => cb(sayfa)),
  parcaDinle: (cb) => ipcRenderer.on('ic:parca', (_e, parca) => cb(String(parca))),
  aramaDurumuDinle: (cb) => ipcRenderer.on('ic:arama-durum', (_e, durum) => cb(durum)),
});
