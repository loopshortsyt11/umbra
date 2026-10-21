'use strict';
// Dolandırıcılık (oltalama) ve zararlı yazılım koruması — Chrome'un "Güvenli Tarama"sına gizlilik dostu karşılık.
// Herkese açık listeler günde bir kez toplu indirilip bilgisayarda saklanır; ziyaret edilen adresler bu yerel listeyle
// karşılaştırılır ve HİÇBİR adres dışarıya (Google'a, liste sağlayıcısına, Anthropic'e) gönderilmez.
// Gizli ve Tor sekmelerinde de denetim tamamen yereldir.
const fs = require('fs');
const path = require('path');

const KAYNAKLAR = [
  // Alan adı listeleri: popüler siteler kaynakta ayıklanmıştır
  { ad: 'malware-filter (URLhaus)', tur: 'zararli', bicim: 'alan', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt' },
  { ad: 'malware-filter (oltalama)', tur: 'oltalama', bicim: 'alan', url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt' },
  { ad: 'Phishing Army', tur: 'oltalama', bicim: 'alan', url: 'https://phishing.army/download/phishing_army_blocklist.txt' },
  // Tam adres listesi: oltalama sayfaları çoğu zaman ortak barındırma servislerindedir (pages.dev vb.);
  // alan adının tamamı değil yalnızca o sayfa engellenir
  { ad: 'OpenPhish', tur: 'oltalama', bicim: 'adres', url: 'https://openphish.com/feed.txt' },
];

const GUN = 24 * 60 * 60 * 1000;

// Listelerde yanlışlıkla yer alsa bile alan adı düzeyinde asla engellenmeyecek büyük servisler
// (bu servislerdeki tek tek oltalama sayfaları adres listesiyle yine yakalanır)
const ASLA_ALAN_ENGELLEME = [
  'google.com', 'youtube.com', 'gmail.com', 'microsoft.com', 'live.com', 'office.com', 'apple.com', 'icloud.com',
  'github.com', 'githubusercontent.com', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'amazon.com', 'amazonaws.com', 'cloudflare.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'x.com',
  'twitter.com', 'wikipedia.org', 'claude.ai', 'anthropic.com', 'duckduckgo.com', 'bing.com', 'dropbox.com',
  'firebaseapp.com', 'web.app', 'blogspot.com', 'wordpress.com', 'weebly.com', 'wixsite.com', 'gov.tr', 'edu.tr',
];

const altAlanMi = (host, alan) => host === alan || host.endsWith('.' + alan);

// Adres karşılaştırması için sadeleştirme: şema, sondaki "/" ve parça (#) önemsiz
function adresAnahtari(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase() + (u.search || '');
  } catch {
    return null;
  }
}

class GuvenlikListesi {
  constructor(dizin, oturum, { gecYukle = false } = {}) {
    this.dosya = path.join(dizin, 'guvenlik-listesi.json');
    this.oturum = oturum; // yalnızca listeleri indirmek için kullanılan, çerezsiz ayrı oturum
    this.alanlar = new Map(); // alan adı -> tür
    this.adresler = new Map(); // adres anahtarı -> tür
    this.zaman = 0;
    this.guncelleniyor = null;
    if (!gecYukle) this.yukle();
  }

  yukle() {
    if (this.zaman) return; // indirme daha önce tamamlandıysa diskteki eski liste okunmaz
    try {
      const v = JSON.parse(fs.readFileSync(this.dosya, 'utf8'));
      this.alanlar = new Map(v.alanlar);
      this.adresler = new Map(v.adresler);
      this.zaman = v.zaman || 0;
    } catch {
      // ilk açılış ya da bozuk dosya: liste indirilene kadar koruma boş
    }
  }

  get boyut() { return this.alanlar.size + this.adresler.size; }

  /** Adres tehlikeli listedeyse { tur: 'oltalama' | 'zararli' }, değilse null */
  denetle(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const anahtar = adresAnahtari(url);
    const tamAdres = anahtar && (this.adresler.get(anahtar) || this.adresler.get(anahtar.replace(/\?.*$/, '')));
    if (tamAdres) return { tur: tamAdres };
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (ASLA_ALAN_ENGELLEME.some((a) => altAlanMi(host, a))) return null;
    // a.b.ornek.com → a.b.ornek.com, b.ornek.com, ornek.com (yalnızca üst düzey alan adı tek başına denenmez)
    const parcalar = host.split('.');
    for (let i = 0; i < parcalar.length - 1; i++) {
      const tur = this.alanlar.get(parcalar.slice(i).join('.'));
      if (tur) return { tur };
    }
    return null;
  }

  /** Liste bir günden eskiyse yeniler; ağ hatasında eldeki liste kullanılmaya devam eder */
  async guncelle({ zorla = false } = {}) {
    if (!zorla && Date.now() - this.zaman < GUN) return false;
    if (this.guncelleniyor) return this.guncelleniyor;
    this.guncelleniyor = this.indir().finally(() => { this.guncelleniyor = null; });
    return this.guncelleniyor;
  }

  async indir() {
    const alanlar = new Map();
    const adresler = new Map();
    let basarili = 0;
    for (const k of KAYNAKLAR) {
      try {
        const yanit = await this.oturum.fetch(k.url, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
        if (!yanit.ok) throw new Error('HTTP ' + yanit.status);
        const metin = await yanit.text();
        for (let satir of metin.split('\n')) {
          satir = satir.trim();
          if (!satir || satir.startsWith('#') || satir.startsWith('!')) continue;
          if (k.bicim === 'alan') {
            const alan = satir.split(/\s+/).pop().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
            if (/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(alan) && !alanlar.has(alan)) alanlar.set(alan, k.tur);
          } else {
            const anahtar = adresAnahtari(satir);
            if (anahtar) adresler.set(anahtar, k.tur);
          }
        }
        basarili++;
      } catch (h) {
        console.error('Güvenlik listesi indirilemedi:', k.ad, h.message);
      }
    }
    // Hiçbir kaynak inmediyse eldeki liste korunur
    if (!basarili) return false;
    this.alanlar = alanlar;
    this.adresler = adresler;
    this.zaman = Date.now();
    const gecici = this.dosya + '.tmp';
    fs.writeFileSync(gecici, JSON.stringify({ zaman: this.zaman, alanlar: [...alanlar], adresler: [...adresler] }));
    fs.renameSync(gecici, this.dosya);
    return true;
  }
}

module.exports = { GuvenlikListesi };
