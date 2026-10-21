'use strict';
// TurboDownloader köprüsü: yerel indirme yöneticisine (127.0.0.1:9614) indirme devri ve sayfadaki medyayı yakalama.
// Kurallar TurboDownloader'ın Chrome eklentisiyle (turbodownloader/extension/background.js) aynıdır.
// İstekler yalnızca ana süreçten gider; TurboDownloader, Origin başlığı taşıyan sayfa isteklerini zaten reddeder.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9614;
const EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TurboDownloader', 'TurboDownloader.exe');
const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|3gp|mp3|m4a|aac|ogg|oga|opus|wav|flac|wma|m3u8|mpd)(\?|#|$)/i;
const STREAM_EXT = /\.(m3u8|mpd)(\?|#|$)/i;
const SEGMENT_HINT = /(\.ts|\.m4s|\.m4f|\.cmf[av])(\?|#|$)|[\/_-](seg|segment|frag|fragment|chunk)[-_]?\d+|init\.mp4/i;
const MEDIA_MIME = /^(video|audio)\/|mpegurl|dash\+xml/i;
const SES_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|wma)(\?|$)/i;
const SKIP_HOSTS = /(^|\.)(googlevideo\.com|doubleclick\.net|googlesyndication\.com)$/i;
const MIN_MEDIA = 200 * 1024; // bundan küçük doğrudan medya dosyaları (reklam/önizleme) listelenmez
const YAKALANAN_TURLER = new Set(['media', 'xhr', 'other', 'object', 'subFrame']);

function istek(yol, govde, zamanAsimi = 4000) {
  return new Promise((coz, reddet) => {
    const veri = govde === undefined ? null : Buffer.from(JSON.stringify(govde));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: yol, method: veri ? 'POST' : 'GET', timeout: zamanAsimi,
      headers: veri ? { 'Content-Type': 'application/json', 'Content-Length': veri.length } : {},
    }, (res) => {
      let metin = '';
      res.setEncoding('utf8');
      res.on('data', (p) => { metin += p; });
      res.on('end', () => {
        try { coz(JSON.parse(metin)); } catch { reddet(new Error('TurboDownloader geçersiz yanıt verdi')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('TurboDownloader yanıt vermedi')));
    req.on('error', reddet);
    if (veri) req.write(veri);
    req.end();
  });
}

function normalize(url) {
  try {
    const u = new URL(url);
    ['range', 'rn', 'rbuf', 'bytestart', 'byteend', 'start', 'end'].forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    return u.toString();
  } catch { return url; }
}

function adiniBul(url) {
  try {
    const p = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return p || new URL(url).hostname;
  } catch { return url; }
}

class TurboIndir {
  constructor() {
    this.acik = false;
    this.medya = new Map(); // webContents.id -> yakalanan medya listesi (en yeni başta)
    this.yokla();
    this.zamanlayici = setInterval(() => this.yokla(), 5000);
    this.zamanlayici.unref?.();
  }

  // will-download içinde eşzamanlı karar verebilmek için uygulamanın açık olup olmadığı arka planda önbelleğe alınır
  async yokla() {
    const onceki = this.acik;
    try {
      const r = await istek('/ping');
      this.acik = Boolean(r && r.app === 'turbodownloader');
    } catch {
      this.acik = false;
    }
    if (onceki !== this.acik) this.degisince?.(this.acik);
    return this.acik;
  }

  kurulu() {
    return fs.existsSync(EXE);
  }

  // Uygulama kapalıysa başlatır ve /ping yanıt verene kadar bekler (en çok 20 × 500 ms)
  async hazirla() {
    if (this.acik || await this.yokla()) return true;
    if (!this.kurulu()) return false;
    if (!this.baslatiliyor) {
      this.baslatiliyor = (async () => {
        try { spawn(EXE, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch { return false; }
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (await this.yokla()) return true;
        }
        return false;
      })().finally(() => { this.baslatiliyor = null; });
    }
    return this.baslatiliyor;
  }

  async cerezler(ses, adres) {
    try {
      return (await ses.cookies.get({ url: adres })).map((c) => `${c.name}=${c.value}`).join('; ');
    } catch { return ''; }
  }

  async gonder(ses, { url = '', pageUrl = '', mode = 'direct', referer = '', filename = '', fallbacks = [], mediaHint = false, quality = 0 }) {
    if (!(await this.hazirla())) throw new Error('TurboDownloader başlatılamadı');
    const r = await istek('/add', {
      url, pageUrl, mode, referer, filename, fallbacks, mediaHint, quality: Number(quality) || 0,
      cookies: await this.cerezler(ses, url || pageUrl), userAgent: ses.getUserAgent(),
    });
    if (!r || !r.ok) throw new Error((r && r.error) || 'TurboDownloader indirmeyi kabul etmedi');
    return r;
  }

  // Sayfadaki videonun kalite listesi; yt-dlp çözümlemesi birkaç saniye sürebildiği için uzun zaman aşımı
  async formatlar(ses, wcId, sayfa, src = '') {
    if (!(await this.hazirla())) return { error: 'TurboDownloader başlatılamadı' };
    try {
      return await istek('/formats', {
        pageUrl: sayfa, src, fallbacks: this.yedekler(wcId),
        cookies: await this.cerezler(ses, sayfa), userAgent: ses.getUserAgent(),
      }, 90000);
    } catch (h) {
      return { error: h.message };
    }
  }

  // Sayfa düzeyinde indirme (eklentideki sendPage ile aynı): kalite menüsü videoyu başka bir adresten
  // (ör. yakalanmış m3u8) çözdüyse önce o adres, sonra yakalananlar ve sayfanın kendisi denenir
  sayfaGonder(ses, wcId, sayfa, { mode = 'video', src = '', quality = 0, source = '' } = {}) {
    const yedek = this.yedekler(wcId);
    if (src && /^https?:/i.test(src)) yedek.unshift(src);
    const hedef = source && /^https?:/i.test(source) ? source : sayfa;
    if (hedef !== sayfa) yedek.push(sayfa);
    return this.gonder(ses, { url: hedef, pageUrl: hedef, mode, referer: sayfa, fallbacks: yedek, quality });
  }

  goster() {
    return istek('/show', {});
  }

  // onHeadersReceived ayrıntılarını inceler; medyaysa sekmenin listesine ekler ve true döner
  yanitIncele(ayr) {
    if (ayr.webContentsId == null || ayr.statusCode >= 400 || !YAKALANAN_TURLER.has(ayr.resourceType)) return false;
    let host = '';
    try { host = new URL(ayr.url).hostname; } catch { return false; }
    if (SKIP_HOSTS.test(host)) return false;
    const h = {};
    for (const [ad, deger] of Object.entries(ayr.responseHeaders || {})) h[ad.toLowerCase()] = [].concat(deger)[0] || '';
    const mime = (h['content-type'] || '').split(';')[0].trim().toLowerCase();
    const akis = STREAM_EXT.test(ayr.url) || /mpegurl|dash\+xml/.test(mime);
    const medya = akis || MEDIA_MIME.test(mime) || (MEDIA_EXT.test(ayr.url) && /octet-stream|binary|^$/.test(mime));
    if (!medya) return false;
    if (!akis && SEGMENT_HINT.test(ayr.url)) return false;

    let boyut = 0;
    const cr = (h['content-range'] || '').match(/\/(\d+)/);
    if (cr) boyut = Number(cr[1]);
    else if (h['content-length']) boyut = Number(h['content-length']);
    if (!akis && boyut && boyut < MIN_MEDIA) return false;

    const url = normalize(ayr.url);
    const liste = this.medya.get(ayr.webContentsId) || [];
    if (liste.some((m) => m.url === url)) return false;
    const tur = akis ? 'akış' : (/^audio\//.test(mime) || SES_EXT.test(url) ? 'ses' : 'video');
    liste.unshift({ url, mime, boyut, tur, ad: adiniBul(url) });
    liste.splice(60);
    this.medya.set(ayr.webContentsId, liste);
    return true;
  }

  medyaListesi(wcId) {
    return this.medya.get(wcId) || [];
  }

  temizle(wcId) {
    this.medya.delete(wcId);
  }

  // Sayfa düzeyindeki indirmede yt-dlp başarısız olursa denenecek yakalanmış adresler
  yedekler(wcId) {
    const liste = this.medyaListesi(wcId);
    const akislar = liste.filter((m) => m.tur === 'akış');
    const dosyalar = liste.filter((m) => m.tur !== 'akış').sort((a, b) => (b.boyut || 0) - (a.boyut || 0));
    // ana çalma listesi (master) genelde ilk yakalanan, dolayısıyla listenin sonundadır
    return [...akislar.reverse(), ...dosyalar].map((m) => m.url).slice(0, 8);
  }
}

module.exports = { TurboIndir };
