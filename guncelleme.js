'use strict';
// Otomatik güncelleme: GitHub Releases'tan yeni sürümü arka planda indirir; dosya bütünlüğü latest.yml'deki SHA-512 ile doğrulanır.
const { EventEmitter } = require('events');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const ARALIK = 4 * 60 * 60 * 1000; // 4 saatte bir denetle

class Guncelleyici extends EventEmitter {
  constructor() {
    super();
    this.durum = { durum: 'bekliyor' };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this._ayarla({ durum: 'denetleniyor' }));
    autoUpdater.on('update-not-available', () => this._ayarla({ durum: 'guncel', zaman: Date.now() }));
    autoUpdater.on('update-available', (b) => this._ayarla({ durum: 'iniyor', surum: b.version, yuzde: 0 }));
    autoUpdater.on('download-progress', (p) => this._ayarla({ ...this.durum, durum: 'iniyor', yuzde: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (b) => this._ayarla({ durum: 'hazir', surum: b.version }));
    autoUpdater.on('error', (h) => this._ayarla({ durum: 'hata', hata: String(h && h.message || h).split('\n')[0] }));
  }

  baslat() {
    // Geliştirme sürümü ve taşınabilir exe kendini güncelleyemez
    if (!app.isPackaged) return this._ayarla({ durum: 'gelistirme' });
    if (process.env.PORTABLE_EXECUTABLE_DIR) return this._ayarla({ durum: 'tasinabilir' });
    this.denetle();
    setInterval(() => this.denetle(), ARALIK).unref?.();
  }

  denetle() {
    if (['gelistirme', 'tasinabilir', 'iniyor', 'hazir'].includes(this.durum.durum)) return;
    autoUpdater.checkForUpdates().catch(() => {}); // hata 'error' olayıyla bildirilir
  }

  yenidenBaslat() {
    if (this.durum.durum === 'hazir') autoUpdater.quitAndInstall(false, true);
  }

  _ayarla(durum) {
    this.durum = durum;
    this.emit('degisti', durum);
  }
}

module.exports = { Guncelleyici };
