// build/logo.svg'yi Chromium ile 1024 px saydam PNG'ye çizer, küçük boyutları ondan yüksek kaliteyle türetir.
// Kullanım: npx electron scripts/logo-ciz.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const HEDEFLER = [
  [1024, 'build/icon.png'],          // electron-builder bunu .ico'ya çevirir
  [512, 'arayuz/simge.png'],          // pencere simgesi
  [128, 'ic/logo.png'],               // iç sayfalardaki logo
  [64, 'arayuz/logo-kucuk.png'],      // sekmelerdeki iç sayfa simgesi
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(KOK, 'build', 'logo.svg'), 'utf8');
  const w = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    useContentSize: true, webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="1024" height="1024" style="display:block"></body></html>`;
  await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  const tam = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  for (const [boyut, hedef] of HEDEFLER) {
    const resim = boyut === 1024 ? tam : tam.resize({ width: boyut, height: boyut, quality: 'best' });
    fs.writeFileSync(path.join(KOK, hedef), resim.toPNG());
    console.log('yazıldı', hedef, boyut);
  }
  app.quit();
});
