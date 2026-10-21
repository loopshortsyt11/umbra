'use strict';
// Umbra Arama'nın klasik (AI'sız) sonuçları: Tümü, Görseller, Videolar, Haberler.
// Sonuçlar arka planda herkese açık arama sayfalarından alınır (Tümü/Videolar/Haberler: DuckDuckGo, Görseller: Bing)
// ve Umbra'nın kendi sayfasında gösterilir. İstekler sekmenin oturumundan gider: şifreli DNS ve izleyici engelleme
// bunlara da uygulanır. Anahtar ya da ücret gerekmez.

const DDG_ZAMAN = { gun: 'd', hafta: 'w', ay: 'm', yil: 'y' };
const BING_ZAMAN = { gun: 1440, hafta: 10080, ay: 43200, yil: 525600 }; // dakika
const ZAMAN_ASIMI = 12000;

const varliklar = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x27': "'", '#39': "'", '#x2F': '/' };
function duzMetin(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tam, v) => {
      if (varliklar[v] !== undefined) return varliklar[v];
      if (v[0] === '#') {
        const kod = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
        return Number.isFinite(kod) ? String.fromCodePoint(kod) : tam;
      }
      return tam;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const webAdresi = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

async function getir(ses, url, secenek = {}) {
  const yanit = await ses.fetch(url, { ...secenek, signal: AbortSignal.timeout(ZAMAN_ASIMI) });
  if (!yanit.ok) throw new Error(`Arama kaynağı yanıt vermedi (${yanit.status})`);
  return yanit;
}

// DuckDuckGo'nun JSON uçları (video/haber) sayfa başına bir doğrulama kodu (vqd) ister
async function vqdAl(ses, q) {
  const metin = await (await getir(ses, `https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`)).text();
  const m = /vqd=["']?([\d-]+)/.exec(metin);
  if (!m) throw new Error('Arama kaynağı doğrulama kodu vermedi');
  return m[1];
}

// --- Tümü: önce DuckDuckGo'nun JavaScript gerektirmeyen sayfası; kısıtlama verir ya da boş dönerse Bing.
// DuckDuckGo kısıtladığında 10 dakika boyunca doğrudan Bing kullanılır (her aramada boşuna beklenmesin).
let ddgBekleme = 0;
async function tumu(ses, q, secenek = {}) {
  if (secenek.devam && secenek.devam.kaynak === 'bing') return bingWeb(ses, q, secenek);
  if (Date.now() > ddgBekleme) {
    try {
      const sonuc = await ddgWeb(ses, q, secenek);
      if (sonuc.sonuclar.length || secenek.devam) return sonuc;
    } catch {}
    ddgBekleme = Date.now() + 10 * 60 * 1000;
  }
  return bingWeb(ses, q, { ...secenek, devam: null });
}

// Bing'in sonuç bağlantıları gerçek adresi "u=a1<base64url>" olarak taşır; doğrudan siteye gidilsin diye çözülür
function bingAdresi(href) {
  const tam = href.replace(/&amp;/g, '&');
  const u = /[?&]u=a1([^&]+)/.exec(tam);
  if (u) {
    try { return webAdresi(Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return ''; }
  }
  return /^https?:\/\/(www\.)?bing\.com\//i.test(tam) ? '' : webAdresi(tam);
}

const BING_WEB_ZAMAN = { gun: 'ez1', hafta: 'ez2', ay: 'ez3' };
async function bingWeb(ses, q, { zaman = '', devam = null } = {}) {
  const ilk = Number(devam && devam.ilk) || 1;
  const filtre = BING_WEB_ZAMAN[zaman] ? `&filters=${encodeURIComponent(`ex1:"${BING_WEB_ZAMAN[zaman]}"`)}` : '';
  const html = await (await getir(ses, `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=tr&cc=TR&first=${ilk}${filtre}`, {
    headers: { 'Accept-Language': 'tr-TR,tr;q=0.9' },
  })).text();
  const sonuclar = [];
  for (const blok of html.split(/<li class="b_algo"/).slice(1)) {
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(blok);
    if (!a) continue;
    const url = bingAdresi(a[1]);
    if (!url) continue;
    const ozet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(blok);
    sonuclar.push({ url, baslik: duzMetin(a[2]), ozet: duzMetin(ozet && ozet[1]).replace(/^(\d+ \S+ \d{4}|[\w ]+ önce) · /, '') });
  }
  return { sonuclar, devam: sonuclar.length >= 5 ? { kaynak: 'bing', ilk: ilk + sonuclar.length } : null };
}

async function ddgWeb(ses, q, { zaman = '', devam = null } = {}) {
  const govde = devam
    ? new URLSearchParams(devam)
    : new URLSearchParams({ q, kl: 'tr-tr', ...(DDG_ZAMAN[zaman] ? { df: DDG_ZAMAN[zaman] } : {}) });
  const html = await (await getir(ses, 'https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: govde.toString(),
  })).text();

  const sonuclar = [];
  for (const blok of html.split('<div class="result ').slice(1)) {
    if (/result--ad/.test(blok.slice(0, 200))) continue; // reklamlar atlanır
    const baslik = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(blok);
    if (!baslik) continue;
    let url = baslik[1].replace(/&amp;/g, '&');
    const yonlendirme = /[?&]uddg=([^&]+)/.exec(url);
    if (yonlendirme) url = decodeURIComponent(yonlendirme[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!webAdresi(url)) continue;
    const ozet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(blok);
    sonuclar.push({ url, baslik: duzMetin(baslik[2]), ozet: duzMetin(ozet && ozet[1]) });
  }

  // Sonraki sayfa: "Next" formunun gizli alanları aynen geri gönderilir
  let sonraki = null;
  const form = /<form[^>]*action="\/html\/"[^>]*>(?:(?!<\/form>)[\s\S])*?value="Next"[\s\S]*?<\/form>/.exec(html);
  if (form) {
    sonraki = {};
    for (const m of form[0].matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) sonraki[m[1]] = duzMetin(m[2]);
    for (const m of form[0].matchAll(/<input[^>]*value="([^"]*)"[^>]*name="([^"]+)"/g)) if (!(m[2] in sonraki)) sonraki[m[2]] = duzMetin(m[1]);
  }
  return { sonuclar, devam: sonraki };
}

// --- Görseller: Bing görsel arama sayfasındaki "m" nitelikleri (görsel, küçük resim, başlık, kaynak sayfa) ---
async function gorseller(ses, q, { zaman = '', devam = null } = {}) {
  const ilk = Number(devam && devam.ilk) || 0;
  const filtre = BING_ZAMAN[zaman] ? `&qft=${encodeURIComponent(`+filterui:age-lt${BING_ZAMAN[zaman]}`)}` : '';
  const html = await (await getir(ses, `https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=${ilk}&count=35&mmasync=1${filtre}`, {
    headers: { 'Accept-Language': 'tr-TR,tr;q=0.9' },
  })).text();
  const sonuclar = [];
  for (const m of html.matchAll(/ m="(\{[^"]*\})"/g)) {
    let v;
    try { v = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { continue; }
    const kucuk = webAdresi(v.turl);
    const sayfa = webAdresi(v.purl);
    if (!kucuk || !sayfa) continue;
    sonuclar.push({ baslik: duzMetin(v.t), sayfa, gorsel: webAdresi(v.murl), kucuk });
  }
  return { sonuclar, devam: sonuclar.length ? { ilk: ilk + 35 } : null };
}

// --- Videolar ve Haberler: DuckDuckGo JSON uçları ---
async function videolar(ses, q) {
  const vqd = await vqdAl(ses, q);
  const j = await (await getir(ses, `https://duckduckgo.com/v.js?l=tr-tr&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,&p=1`, {
    headers: { Referer: 'https://duckduckgo.com/' },
  })).json();
  const sonuclar = (j.results || []).map((v) => ({
    baslik: duzMetin(v.title), url: webAdresi(v.content), ozet: duzMetin(v.description),
    kucuk: webAdresi(v.images && (v.images.medium || v.images.small)), sure: String(v.duration || ''),
    yayinci: duzMetin(v.uploader || v.publisher), tarih: String(v.published || '').slice(0, 10),
    izlenme: v.statistics && v.statistics.viewCount ? Number(v.statistics.viewCount) : 0,
  })).filter((v) => v.url);
  return { sonuclar, devam: null };
}

async function haberler(ses, q, { zaman = '' } = {}) {
  const vqd = await vqdAl(ses, q);
  const df = DDG_ZAMAN[zaman] && zaman !== 'yil' ? `&df=${DDG_ZAMAN[zaman]}` : '';
  const j = await (await getir(ses, `https://duckduckgo.com/news.js?l=tr-tr&o=json&noamp=1&q=${encodeURIComponent(q)}&vqd=${vqd}${df}`, {
    headers: { Referer: 'https://duckduckgo.com/' },
  })).json();
  const sonuclar = (j.results || []).map((h) => ({
    baslik: duzMetin(h.title), url: webAdresi(h.url), ozet: duzMetin(h.excerpt),
    kucuk: webAdresi(h.image), kaynak: duzMetin(h.source), zaman: duzMetin(h.relative_time),
  })).filter((h) => h.url);
  return { sonuclar, devam: null };
}

const MODLAR = { tumu, gorsel: gorseller, video: videolar, haber: haberler };

async function webArama(ses, mod, q, secenek) {
  const islev = MODLAR[mod] || tumu;
  q = String(q || '').trim().slice(0, 500);
  if (!q) return { sonuclar: [], devam: null };
  return islev(ses, q, secenek || {});
}

module.exports = { webArama, MODLAR: Object.keys(MODLAR) };
