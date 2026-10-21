'use strict';
// Kullanıcı verileri: JSON dosyaları, yazımlar toplanıp gecikmeli ve atomik (geçici dosya + yeniden adlandırma) yapılır.
const fs = require('fs');
const path = require('path');

const ARAMA_MOTORLARI = {
  umbra: { ad: 'Umbra Arama (AI, kaynaklı yanıt)', ara: 'umbra://ara?q=', ana: 'umbra://ara' },
  duckduckgo: { ad: 'DuckDuckGo', ara: 'https://duckduckgo.com/?q=', ana: 'https://duckduckgo.com/' },
  google: { ad: 'Google', ara: 'https://www.google.com/search?q=', ana: 'https://www.google.com/' },
  bing: { ad: 'Bing', ara: 'https://www.bing.com/search?q=', ana: 'https://www.bing.com/' },
  brave: { ad: 'Brave Search', ara: 'https://search.brave.com/search?q=', ana: 'https://search.brave.com/' },
  startpage: { ad: 'Startpage', ara: 'https://www.startpage.com/do/search?q=', ana: 'https://www.startpage.com/' },
  mojeek: { ad: 'Mojeek', ara: 'https://www.mojeek.com/search?q=', ana: 'https://www.mojeek.com/' },
};
// Gizli ve Tor sekmelerinde kullanılabilecek, hesap gerektirmeyen ve izleyicisiz motorlar
const OZEL_MOTORLAR = ['brave', 'startpage', 'mojeek', 'duckduckgo'];
// Gizli/Tor sekmelerinin açılış sayfası: Umbra'nın yerel (internete bağlanmayan) başlangıç sayfası
const OZEL_BASLANGIC = 'umbra://baslangic';

const VARSAYILAN_AYARLAR = {
  aramaMotoru: 'umbra',
  ozelAramaMotoru: 'brave',  // gizli ve Tor sekmelerinde
  anaSayfa: '',              // boşsa Umbra'nın yeni sekme sayfası
  acilis: 'yeni-sekme',      // Chrome'daki gibi: 'yeni-sekme' ya da 'devam' (kaldığın yerden devam et)
  izleyiciEngelle: true,
  turboIndir: true,          // normal sekmelerdeki indirmeleri TurboIndir'e devret (gizli/Tor'da asla)
};

const GECMIS_SINIRI = 10000;

// Adres çubuğuna tek kelime yazıldığında (ör. "youtube") geçmişte yoksa gidilecek bilinen siteler
const BILINEN_SITELER = {
  youtube: 'www.youtube.com', google: 'www.google.com', gmail: 'mail.google.com', drive: 'drive.google.com',
  maps: 'maps.google.com', translate: 'translate.google.com', ceviri: 'translate.google.com',
  facebook: 'www.facebook.com', instagram: 'www.instagram.com', whatsapp: 'web.whatsapp.com',
  twitter: 'x.com', x: 'x.com', tiktok: 'www.tiktok.com', reddit: 'www.reddit.com', linkedin: 'www.linkedin.com',
  twitch: 'www.twitch.tv', kick: 'kick.com', discord: 'discord.com', telegram: 'web.telegram.org',
  netflix: 'www.netflix.com', spotify: 'open.spotify.com', disney: 'www.disneyplus.com', exxen: 'www.exxen.com',
  wikipedia: 'tr.wikipedia.org', vikipedi: 'tr.wikipedia.org', github: 'github.com', stackoverflow: 'stackoverflow.com',
  outlook: 'outlook.live.com', hotmail: 'outlook.live.com', yahoo: 'www.yahoo.com', bing: 'www.bing.com',
  amazon: 'www.amazon.com.tr', trendyol: 'www.trendyol.com', hepsiburada: 'www.hepsiburada.com',
  sahibinden: 'www.sahibinden.com', n11: 'www.n11.com', ciceksepeti: 'www.ciceksepeti.com', getir: 'getir.com',
  yemeksepeti: 'www.yemeksepeti.com', eksisozluk: 'eksisozluk.com', eksi: 'eksisozluk.com',
  chatgpt: 'chatgpt.com', claude: 'claude.ai', gemini: 'gemini.google.com', edevlet: 'www.turkiye.gov.tr',
  hurriyet: 'www.hurriyet.com.tr', sozcu: 'www.sozcu.com.tr', milliyet: 'www.milliyet.com.tr', ntv: 'www.ntv.com.tr',
  steam: 'store.steampowered.com', epic: 'store.epicgames.com', roblox: 'www.roblox.com',
};

class Depo {
  constructor(dosya, varsayilan) {
    this.dosya = dosya;
    this.zamanlayici = null;
    try {
      this.veri = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    } catch {
      this.veri = structuredClone(varsayilan);
    }
  }

  kaydet() {
    if (this.zamanlayici) return;
    this.zamanlayici = setTimeout(() => this.hemenKaydet(), 800);
  }

  hemenKaydet() {
    clearTimeout(this.zamanlayici);
    this.zamanlayici = null;
    const gecici = this.dosya + '.tmp';
    try {
      fs.writeFileSync(gecici, JSON.stringify(this.veri));
      fs.renameSync(gecici, this.dosya);
    } catch (h) {
      console.error('Kayıt hatası', this.dosya, h);
    }
  }
}

class Veri {
  constructor(dizin) {
    fs.mkdirSync(dizin, { recursive: true });
    const d = (ad, v) => new Depo(path.join(dizin, ad), v);
    this.ayarDeposu = d('ayarlar.json', VARSAYILAN_AYARLAR);
    this.ayarDeposu.veri = { ...VARSAYILAN_AYARLAR, ...this.ayarDeposu.veri };
    this.gecmisDeposu = d('gecmis.json', []);
    this.yerImiDeposu = d('yer-imleri.json', []);
    this.indirmeDeposu = d('indirilenler.json', []);
    this.oturumDeposu = d('oturum.json', []);
    // Kapanışta yarım kalan indirmeler "kesildi" sayılır
    for (const i of this.indirmeDeposu.veri) if (i.durum === 'iniyor') i.durum = 'kesildi';
  }

  get ayarlar() { return this.ayarDeposu.veri; }

  ayarla(anahtar, deger) {
    if (!(anahtar in VARSAYILAN_AYARLAR) || typeof deger !== typeof VARSAYILAN_AYARLAR[anahtar]) return false;
    if (anahtar === 'aramaMotoru' && !ARAMA_MOTORLARI[deger]) return false;
    if (anahtar === 'ozelAramaMotoru' && !OZEL_MOTORLAR.includes(deger)) return false;
    if (anahtar === 'acilis' && !['yeni-sekme', 'devam'].includes(deger)) return false;
    if (anahtar === 'anaSayfa' && deger && !/^https?:\/\//i.test(deger)) return false;
    this.ayarlar[anahtar] = deger;
    this.ayarDeposu.kaydet();
    return true;
  }

  ozelMotor() {
    return ARAMA_MOTORLARI[this.ayarlar.ozelAramaMotoru] || ARAMA_MOTORLARI.brave;
  }

  // Umbra Arama sorguyu Anthropic'e gönderir: gizli/Tor sekmelerinde ve AI anahtarı yokken özel motor kullanılır
  motor(tur = 'normal') {
    if (tur === 'gizli' || tur === 'tor') return this.ozelMotor();
    const m = ARAMA_MOTORLARI[this.ayarlar.aramaMotoru] || ARAMA_MOTORLARI.umbra;
    return m === ARAMA_MOTORLARI.umbra && !this.aiVarMi() ? this.ozelMotor() : m;
  }

  aiVarMi() { return true; } // ana süreç, AI anahtarının olup olmadığını söyleyen işlevle değiştirir

  // Yeni sekme sayfası: normal sekmelerde umbra://ara, gizli/Tor sekmelerinde yerel başlangıç sayfası
  anaSayfa(tur = 'normal') {
    if (this.ayarlar.anaSayfa) return this.ayarlar.anaSayfa;
    return tur === 'gizli' || tur === 'tor' ? OZEL_BASLANGIC : 'umbra://ara';
  }
  aramaAdresi(metin, tur = 'normal') { return this.motor(tur).ara + encodeURIComponent(metin); }

  // --- Geçmiş ---
  get gecmis() { return this.gecmisDeposu.veri; }

  gecmiseEkle(url, baslik) {
    const g = this.gecmis;
    const son = g[g.length - 1];
    if (son && son.url === url && Date.now() - son.zaman < 30000) { son.baslik = baslik || son.baslik; }
    else g.push({ url, baslik: baslik || '', zaman: Date.now() });
    if (g.length > GECMIS_SINIRI) g.splice(0, g.length - GECMIS_SINIRI);
    this.gecmisDeposu.kaydet();
  }

  basligiGuncelle(url, baslik) {
    const g = this.gecmis;
    for (let i = g.length - 1; i >= Math.max(0, g.length - 20); i--) {
      if (g[i].url === url) { g[i].baslik = baslik; this.gecmisDeposu.kaydet(); return; }
    }
  }

  gecmisiSil(zamanlar) {
    if (zamanlar === 'hepsi') this.gecmisDeposu.veri = [];
    else {
      const sil = new Set(zamanlar);
      this.gecmisDeposu.veri = this.gecmis.filter((g) => !sil.has(g.zaman));
    }
    this.gecmisDeposu.kaydet();
  }

  // --- Yer imleri ---
  get yerImleri() { return this.yerImiDeposu.veri; }
  yerImiMi(url) { return this.yerImleri.some((y) => y.url === url); }

  yerImiDegistir(url, baslik) {
    const i = this.yerImleri.findIndex((y) => y.url === url);
    if (i >= 0) this.yerImleri.splice(i, 1);
    else this.yerImleri.push({ id: Date.now() + Math.random(), url, baslik: baslik || url, zaman: Date.now() });
    this.yerImiDeposu.kaydet();
    return i < 0;
  }

  yerImiDuzenle(id, baslik, url) {
    const y = this.yerImleri.find((x) => x.id === id);
    if (!y || !/^https?:\/\//i.test(url)) return false;
    y.baslik = String(baslik).slice(0, 300);
    y.url = url;
    this.yerImiDeposu.kaydet();
    return true;
  }

  yerImiSil(id) {
    this.yerImiDeposu.veri = this.yerImleri.filter((y) => y.id !== id);
    this.yerImiDeposu.kaydet();
  }

  // Tek kelimelik girdiden ("youtube") gidilecek siteyi tahmin eder: önce yer imleri ve geçmişte en çok
  // ziyaret edilen eşleşen site, yoksa bilinen siteler listesi. Bulamazsa null (girdi aranır).
  siteTahmini(girdi) {
    const ad = String(girdi || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(ad)) return null;
    const sayim = new Map();
    for (const kayit of [...this.yerImleri, ...this.gecmis]) {
      let u;
      try { u = new URL(kayit.url); } catch { continue; }
      if (u.protocol !== 'https:') continue;
      const host = u.hostname.replace(/^www\./, '');
      if (host.split('.')[0] !== ad) continue;
      sayim.set(u.origin, (sayim.get(u.origin) || 0) + 1);
    }
    if (sayim.size) return [...sayim.entries()].sort((a, b) => b[1] - a[1])[0][0] + '/';
    return BILINEN_SITELER[ad] ? `https://${BILINEN_SITELER[ad]}/` : null;
  }

  // --- Adres çubuğu önerileri: tahmin edilen site, yer imleri, sonra sık ziyaret edilen geçmiş ---
  oneriler(metin, adet = 6) {
    const q = metin.trim().toLowerCase();
    if (!q) return [];
    const site = this.siteTahmini(q);
    if (site) adet -= 1;
    const uyar = (x) => x.url.toLowerCase().includes(q) || (x.baslik || '').toLowerCase().includes(q);
    const sonuc = [];
    const gorulen = new Set();
    for (const y of this.yerImleri) {
      if (sonuc.length >= adet) break;
      if (uyar(y) && !gorulen.has(y.url)) { gorulen.add(y.url); sonuc.push({ url: y.url, baslik: y.baslik, tur: 'yerimi' }); }
    }
    const sayim = new Map();
    for (const g of this.gecmis) {
      if (!uyar(g)) continue;
      const s = sayim.get(g.url) || { url: g.url, baslik: g.baslik, puan: 0 };
      s.puan += 1; s.baslik = g.baslik || s.baslik;
      sayim.set(g.url, s);
    }
    const sirali = [...sayim.values()].sort((a, b) => b.puan - a.puan);
    for (const g of sirali) {
      if (sonuc.length >= adet) break;
      if (!gorulen.has(g.url)) { gorulen.add(g.url); sonuc.push({ url: g.url, baslik: g.baslik, tur: 'gecmis' }); }
    }
    if (site) sonuc.unshift({ url: site, baslik: new URL(site).hostname.replace(/^www\./, ''), tur: 'site' });
    return sonuc;
  }

  // --- İndirilenler ---
  get indirilenler() { return this.indirmeDeposu.veri; }

  indirmeKaydet() { this.indirmeDeposu.kaydet(); }

  indirmeleriTemizle() {
    this.indirmeDeposu.veri = this.indirilenler.filter((i) => i.durum === 'iniyor');
    this.indirmeDeposu.kaydet();
  }

  // --- Oturum ---
  get oturum() { return this.oturumDeposu.veri; }
  oturumKaydet(adresler) { this.oturumDeposu.veri = adresler; this.oturumDeposu.kaydet(); }

  // --- Yedekleme: AI anahtarı ve çerezler bilerek dahil edilmez (bu bilgisayara özel şifrelidir) ---
  disaAktar({ yerImleri = true, gecmis = true, ayarlar = true } = {}) {
    return {
      uygulama: 'umbra',
      bicim: 1,
      tarih: new Date().toISOString(),
      ...(yerImleri ? { yerImleri: this.yerImleri } : {}),
      ...(gecmis ? { gecmis: this.gecmis } : {}),
      ...(ayarlar ? { ayarlar: this.ayarlar } : {}),
    };
  }

  // Yedek dosyası güvenilmeyen girdidir: her kayıt tek tek denetlenir, mevcut verilerle birleştirilir (silme yok)
  iceAktar(yedek) {
    if (!yedek || yedek.uygulama !== 'umbra' || yedek.bicim !== 1) throw new Error('Bu bir Umbra yedek dosyası değil.');
    const adresMi = (u) => typeof u === 'string' && u.length <= 4096 && /^https?:\/\//i.test(u);
    const metin = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
    const sayi = { yerImleri: 0, gecmis: 0, ayarlar: 0 };

    if (Array.isArray(yedek.yerImleri)) {
      const mevcut = new Set(this.yerImleri.map((y) => y.url));
      for (const y of yedek.yerImleri.slice(0, 50000)) {
        if (!y || !adresMi(y.url) || mevcut.has(y.url)) continue;
        mevcut.add(y.url);
        this.yerImleri.push({ id: Date.now() + Math.random(), url: y.url, baslik: metin(y.baslik, 300) || y.url, zaman: Number(y.zaman) || Date.now() });
        sayi.yerImleri++;
      }
      this.yerImiDeposu.kaydet();
    }

    if (Array.isArray(yedek.gecmis)) {
      const mevcut = new Set(this.gecmis.map((g) => `${g.zaman}|${g.url}`));
      for (const g of yedek.gecmis.slice(-GECMIS_SINIRI)) {
        const zaman = Number(g && g.zaman);
        if (!g || !adresMi(g.url) || !Number.isFinite(zaman) || mevcut.has(`${zaman}|${g.url}`)) continue;
        mevcut.add(`${zaman}|${g.url}`);
        this.gecmis.push({ url: g.url, baslik: metin(g.baslik, 300), zaman });
        sayi.gecmis++;
      }
      this.gecmis.sort((a, b) => a.zaman - b.zaman);
      if (this.gecmis.length > GECMIS_SINIRI) this.gecmis.splice(0, this.gecmis.length - GECMIS_SINIRI);
      this.gecmisDeposu.kaydet();
    }

    if (yedek.ayarlar && typeof yedek.ayarlar === 'object') {
      for (const [k, v] of Object.entries(yedek.ayarlar)) if (this.ayarla(k, v)) sayi.ayarlar++;
    }
    return sayi;
  }

  hepsiniKaydet() {
    for (const d of [this.ayarDeposu, this.gecmisDeposu, this.yerImiDeposu, this.indirmeDeposu, this.oturumDeposu]) {
      if (d.zamanlayici) d.hemenKaydet();
    }
  }
}

module.exports = { Veri, ARAMA_MOTORLARI, OZEL_MOTORLAR, OZEL_BASLANGIC };
