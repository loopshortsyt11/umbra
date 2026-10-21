const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ai', {
  durum: () => ipcRenderer.invoke('ai:durum'),
  anahtarKaydet: (anahtar) => ipcRenderer.invoke('ai:anahtar', String(anahtar)),
  anahtarSil: () => ipcRenderer.invoke('ai:anahtar-sil'),
  sor: (soru, sayfaDahil) => ipcRenderer.invoke('ai:sor', String(soru), sayfaDahil === true),
  durdur: () => ipcRenderer.send('ai:durdur'),
  sifirla: () => ipcRenderer.send('ai:sifirla'),
  kapat: () => ipcRenderer.send('ai:panel'),
  konsoluAc: () => ipcRenderer.send('ai:konsol'),
  parcaDinle: (cb) => ipcRenderer.on('ai:parca', (_e, metin) => cb(metin)),
  soruDinle: (cb) => ipcRenderer.on('ai:hazir-soru', (_e, soru) => cb(soru)),
  sekmeDinle: (cb) => ipcRenderer.on('ai:sekme', (_e, bilgi) => cb(bilgi)),
});
