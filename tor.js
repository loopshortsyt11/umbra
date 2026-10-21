'use strict';
// Gömülü tor.exe'yi yönetir. Doğrudan bağlantı engelliyse sırayla köprüleri (obfs4, snowflake, meek) dener.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');

// bekleme: Bootstrapped yüzdesi bu kadar süre ilerlemezse sonraki yönteme geçilir
// Snowflake, sansürlü ağlarda (ör. Türkiye) en güvenilir köprü olduğu için doğrudan bağlantıdan hemen sonra denenir
const MODLAR = [
  { ad: 'dogrudan', bekleme: 25000 },
  { ad: 'snowflake', bekleme: 60000 },
  { ad: 'obfs4', bekleme: 35000 },
  { ad: 'meek', bekleme: 60000 },
];

const ileriEgik = (p) => p.replace(/\\/g, '/');

function bosPort() {
  return new Promise((coz, reddet) => {
    const sunucu = net.createServer();
    sunucu.unref();
    sunucu.on('error', reddet);
    sunucu.listen(0, '127.0.0.1', () => {
      const { port } = sunucu.address();
      sunucu.close(() => coz(port));
    });
  });
}

class Tor extends EventEmitter {
  constructor(kok, veriDizini) {
    super();
    this.kok = kok;               // tor-paket klasörü
    this.veri = veriDizini;       // kullanıcı verisi altında tor klasörü
    this.surec = null;
    this.port = null;
    this.baglanti = null;
  }

  baglan() {
    if (!this.baglanti) {
      this.baglanti = this._baglan().catch((h) => {
        this.baglanti = null;
        throw h;
      });
    }
    return this.baglanti;
  }

  durdur() {
    if (this.surec) this.surec.kill();
    this.surec = null;
    this.baglanti = null;
  }

  async _baglan() {
    fs.mkdirSync(this.veri, { recursive: true });
    const pt = JSON.parse(fs.readFileSync(path.join(this.kok, 'tor', 'pluggable_transports', 'pt_config.json'), 'utf8'));
    const son = this._oku('son-yontem.txt');
    const sira = [...MODLAR].sort((a, b) => (b.ad === son) - (a.ad === son));
    for (const mod of sira) {
      try {
        await this._dene(mod, pt);
        this._yaz('son-yontem.txt', mod.ad);
        return this.port;
      } catch (h) {
        this.emit('durum', { yuzde: 0, yontem: mod.ad, hata: h.message });
      }
    }
    throw new Error('Doğrudan bağlantı ve tüm köprüler (obfs4, snowflake, meek) denendi, hiçbiri çalışmadı.');
  }

  _ayarlar(mod, pt, port) {
    const satirlar = [
      `DataDirectory "${ileriEgik(path.join(this.veri, 'veri'))}"`,
      `GeoIPFile "${ileriEgik(path.join(this.kok, 'data', 'geoip'))}"`,
      `GeoIPv6File "${ileriEgik(path.join(this.kok, 'data', 'geoip6'))}"`,
      `SocksPort 127.0.0.1:${port}`,
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'Log notice stdout',
    ];
    if (mod.ad !== 'dogrudan') {
      const eklenti = mod.ad === 'snowflake' ? pt.pluggableTransports.snowflake : pt.pluggableTransports.lyrebird;
      // tor.exe, tor klasöründe çalıştığı için köprü programı göreli yolla bulunur (boşluklu yollarda da çalışır)
      satirlar.push('UseBridges 1', eklenti.replace('${pt_path}', 'pluggable_transports\\'));
      for (const kopru of pt.bridges[mod.ad] || []) satirlar.push('Bridge ' + kopru);
    }
    return satirlar.join('\n') + '\n';
  }

  async _dene(mod, pt) {
    this.durdur();
    const port = await bosPort();
    const torrc = path.join(this.veri, 'torrc');
    const varsayilan = path.join(this.veri, 'torrc-defaults');
    fs.writeFileSync(torrc, this._ayarlar(mod, pt, port));
    fs.writeFileSync(varsayilan, '');
    this.emit('durum', { yuzde: 0, yontem: mod.ad });

    await new Promise((coz, reddet) => {
      const surec = spawn(path.join(this.kok, 'tor', 'tor.exe'), ['-f', torrc, '--defaults-torrc', varsayilan], {
        cwd: path.join(this.kok, 'tor'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.surec = surec;
      let yuzde = 0, bitti = false, artik = '';
      let zamanlayici;
      const bitir = (hata) => {
        if (bitti) return;
        bitti = true;
        clearTimeout(zamanlayici);
        if (hata) { surec.kill(); reddet(hata); } else coz();
      };
      const kur = () => {
        clearTimeout(zamanlayici);
        zamanlayici = setTimeout(() => bitir(new Error(`${mod.ad}: %${yuzde}'de takıldı`)), mod.bekleme);
      };
      kur();
      surec.stdout.on('data', (parca) => {
        const satirlar = (artik + parca.toString()).split(/\r?\n/);
        artik = satirlar.pop();
        for (const satir of satirlar) {
          const m = /Bootstrapped (\d+)%/.exec(satir);
          if (!m) continue;
          const yeni = Number(m[1]);
          if (yeni > yuzde) { yuzde = yeni; kur(); this.emit('durum', { yuzde, yontem: mod.ad }); }
          if (yuzde >= 100) { this.port = port; bitir(); }
        }
      });
      surec.on('error', (h) => bitir(h));
      surec.on('exit', (kod) => {
        if (this.surec === surec) { this.surec = null; this.baglanti = null; }
        bitir(new Error(`${mod.ad}: tor kapandı (kod ${kod})`));
      });
    });
  }

  _oku(ad) {
    try { return fs.readFileSync(path.join(this.veri, ad), 'utf8').trim(); } catch { return ''; }
  }

  _yaz(ad, icerik) {
    try { fs.writeFileSync(path.join(this.veri, ad), icerik); } catch {}
  }
}

module.exports = { Tor };
