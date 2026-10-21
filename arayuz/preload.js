const { contextBridge, ipcRenderer } = require('electron');

// Arayüze yalnızca bu dar komut seti açılır; Node.js veya ipcRenderer doğrudan verilmez.
contextBridge.exposeInMainWorld('umbra', {
  yeniSekme: (tur) => ipcRenderer.send('tab:new', String(tur || 'normal')),
  sekmeKapat: (id) => ipcRenderer.send('tab:close', id),
  sekmeyeGec: (id) => ipcRenderer.send('tab:switch', id),
  git: (girdi) => ipcRenderer.send('nav:go', String(girdi)),
  geri: () => ipcRenderer.send('nav:back'),
  ileri: () => ipcRenderer.send('nav:forward'),
  yenile: () => ipcRenderer.send('nav:reload'),
  durdur: () => ipcRenderer.send('nav:stop'),
  anaSayfa: () => ipcRenderer.send('nav:home'),
  aiPaneli: () => ipcRenderer.send('ai:panel'),
  yerImi: () => ipcRenderer.send('yerimi:degistir'),
  indirilenler: () => ipcRenderer.send('indirilenler:ac'),
  menu: (x, y) => ipcRenderer.send('ui:menu', Number(x), Number(y)),
  medyaMenusu: (x, y) => ipcRenderer.send('medya:menu', Number(x), Number(y)),
  guncelle: () => ipcRenderer.send('guncelleme:yeniden'),
  yukseklik: (ek) => ipcRenderer.send('ui:yukseklik', Number(ek)),
  oneriler: (metin) => ipcRenderer.invoke('oneri:al', String(metin)),
  bulAra: (metin, ileri, yeni) => ipcRenderer.send('bul:ara', String(metin), ileri !== false, yeni === true),
  bulKapat: () => ipcRenderer.send('bul:kapat'),
  guncellemeyiDinle: (cb) => ipcRenderer.on('tabs:update', (_e, durum) => cb(durum)),
  odakDinle: (cb) => ipcRenderer.on('focus:address', () => cb()),
  bulAcDinle: (cb) => ipcRenderer.on('bul:ac', () => cb()),
  bulKapatDinle: (cb) => ipcRenderer.on('bul:kapat', () => cb()),
  bulSonucDinle: (cb) => ipcRenderer.on('bul:sonuc', (_e, s) => cb(s)),
});
