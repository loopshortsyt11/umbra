'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, session, dialog, Menu, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { Tor } = require('./tor');
const { Asistan } = require('./ai');
const { Veri, ARAMA_MOTORLARI, OZEL_MOTORLAR, OZEL_BASLANGIC, klasorAdi } = require('./veri');
const { TurboIndir } = require('./turboindir');
const { Guncelleyici } = require('./guncelleme');
const { GuvenlikListesi } = require('./guvenlik');
const { webArama } = require('./arama');

const UI_YUKSEKLIK = 82;
const CUBUK_YUKSEKLIK = 30; // adres çubuğunun altındaki yer işaretleri çubuğu
const ustYukseklik = () => UI_YUKSEKLIK + (veri.ayarlar.yerImiCubugu ? CUBUK_YUKSEKLIK : 0);
const PANEL_GENISLIK = 400;
const TOR_KOK = app.isPackaged ? path.join(process.resourcesPath, 'tor-paket') : path.join(__dirname, 'tor-paket');
const SIMGE = path.join(__dirname, 'arayuz', 'simge.png');
const TURLER = ['normal', 'gizli', 'tor'];
const IC_SAYFALAR = ['ara', 'gecmis', 'yer-imleri', 'indirilenler', 'ayarlar'];
// Tor hazır olana kadar Tor sekmelerinin trafiği kapalı bir porta gider: bağlantı yoksa sayfa da açılmaz
const KAPALI_PROXY = { proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' };
const YONTEM_ADLARI = { dogrudan: 'doğrudan', obfs4: 'obfs4 köprüsü', snowflake: 'Snowflake köprüsü', meek: 'meek köprüsü' };

// Reklam/izleyici alan adları (alt alan adları da engellenir)
const IZLEYICILER = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com',
  'googleadservices.com', 'adservice.google.com', 'connect.facebook.net', 'scorecardresearch.com',
  'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'hotjar.com',
  'amazon-adsystem.com', 'ads-twitter.com', 'analytics.tiktok.com', 'quantserve.com', 'moatads.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'mc.yandex.ru', 'clarity.ms', 'adform.net',
  'smartadserver.com', 'casalemedia.com', 'yieldmo.com', 'bidswitch.net', 'mathtag.com',
];

const OTOMATIK_IZINLER = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const SORULAN_IZINLER = {
  media: 'kamera / mikrofon',
  geolocation: 'konumunuz',
  notifications: 'bildirim göndermek',
  'clipboard-read': 'panonuzu okumak',
};
const RISKLI_DOSYA = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|hta|jar|lnk|reg|dll)$/i;

app.enableSandbox();
app.commandLine.appendSwitch('site-per-process');

// Otomatik derleme hattının duman testi: arayüz ve ilk sekme sorunsuz yüklenirse 0, aksi halde 1 ile çıkar
const DUMAN_TESTI = process.argv.includes('--duman-testi');
const ARAYUZ_TESTI = !app.isPackaged && process.argv.includes('--arayuz-testi'); // yalnızca geliştirme sürümünde
if (ARAYUZ_TESTI) {
  // Test penceresi başka pencerelerin altında kalsa da çizim ve boyutlanma durmasın
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.setPath('userData', path.join(app.getPath('temp'), `umbra-arayuz-testi-${process.pid}`));
  // Ücretli AI arama testi için: verilen klasördeki şifreli anahtar (ve onu açan Local State) test klasörüne kopyalanır
  const anahtarKlasoru = process.env.UMBRA_TEST_ANAHTAR_KLASORU;
  if (anahtarKlasoru) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    for (const ad of ['Local State', 'ai-anahtar.bin']) fs.copyFileSync(path.join(anahtarKlasoru, ad), path.join(app.getPath('userData'), ad));
  }
}
if (DUMAN_TESTI) {
  // Kullanıcının verilerine dokunmamak ve açık bir Umbra'yla çakışmamak için geçici veri klasörü
  app.setPath('userData', path.join(app.getPath('temp'), `umbra-duman-${process.pid}`));
  process.on('uncaughtException', (h) => { console.error('DUMAN TESTİ HATASI', h); app.exit(1); });
  setTimeout(() => { console.error('DUMAN TESTİ: zaman aşımı'); app.exit(1); }, 60000);
}

// Beklenmedik bir hata tarayıcıyı kilitlemesin: Electron'un varsayılan hata penceresi yerine kaydedilip devam edilir
// (duman testi kendi işleyicisiyle çıkış koduna çevirir)
if (!DUMAN_TESTI) {
  process.on('uncaughtException', (h) => console.error('Beklenmedik hata', h));
  process.on('unhandledRejection', (h) => console.error('Yakalanmamış söz hatası', h));
}

// Tarayıcının eski adı "Kalkan" idi: o adla kaydedilmiş veriler (geçmiş, çerezler, AI anahtarı) bir kez yeni klasöre taşınır
if (!DUMAN_TESTI && !ARAYUZ_TESTI) {
  const yeni = app.getPath('userData');
  const eski = path.join(app.getPath('appData'), 'Kalkan');
  // Electron yeni klasörü açılışta boş olarak oluşturabildiği için ölçüt, Umbra'nın kendi ayar dosyasının henüz olmamasıdır
  if (fs.existsSync(eski) && !fs.existsSync(path.join(yeni, 'ayarlar.json'))) {
    try {
      fs.mkdirSync(yeni, { recursive: true });
      for (const ad of fs.readdirSync(eski)) {
        const hedef = path.join(yeni, ad);
        fs.rmSync(hedef, { recursive: true, force: true }); // açılışta oluşan boş kopyanın yerine eskisi geçer
        fs.renameSync(path.join(eski, ad), hedef);
      }
      fs.rmSync(eski, { recursive: true, force: true });
      const bolumler = path.join(yeni, 'Partitions');
      if (fs.existsSync(path.join(bolumler, 'kalkan'))) {
        fs.rmSync(path.join(bolumler, 'umbra'), { recursive: true, force: true });
        fs.renameSync(path.join(bolumler, 'kalkan'), path.join(bolumler, 'umbra'));
      }
      const oturum = path.join(yeni, 'oturum.json');
      if (fs.existsSync(oturum)) fs.writeFileSync(oturum, fs.readFileSync(oturum, 'utf8').replaceAll('kalkan://', 'umbra://'));
    } catch (h) {
      console.error('Eski Kalkan verileri taşınamadı', h);
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();

let pencere, arayuz, normalOturum, tor, asistan, veri, turbo, guvenlik;

// --- Dolandırıcılık ve zararlı yazılım koruması (yerel liste; adresler dışarı gönderilmez) ---
const GUVENLIK_HOST = 'umbra-guvenlik.invalid'; // uyarı sayfasındaki "geri dön" / "yine de devam et" bağlantıları
const riskKabul = new Set();      // "etiket|alan adı": kullanıcının uyarıya rağmen devam ettiği siteler (oturum boyunca)
const guvenlikEngeli = new Map(); // webContents.id -> { url, tur }: engellenen ve uyarısı gösterilecek sayfa
const devamBiletleri = new Map(); // tek kullanımlık "yine de devam et" bileti -> { url, etiket }

function guvenlikUyarisi(url, tur) {
  const kac = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let host = url;
  try { host = new URL(url).hostname; } catch {}
  const bilet = require('crypto').randomBytes(16).toString('hex');
  devamBiletleri.set(bilet, { url });
  if (devamBiletleri.size > 100) devamBiletleri.delete(devamBiletleri.keys().next().value);
  const oltalama = tur === 'oltalama';
  const baslik = oltalama ? 'Tehlikeli site: dolandırıcılık' : 'Tehlikeli site: zararlı yazılım';
  const aciklama = oltalama
    ? `<b>${kac(host)}</b> sitesi bilinen bir dolandırıcılık (oltalama) sitesi. Şifrenizi, kart bilgilerinizi ya da kimlik bilgilerinizi çalmak için gerçek bir siteyi taklit ediyor olabilir.`
    : `<b>${kac(host)}</b> sitesi zararlı yazılım yaydığı bilinen bir site. Bilgisayarınıza virüs, fidye yazılımı ya da casus yazılım bulaştırabilir.`;
  const html = `<!doctype html><meta charset="utf-8"><title>${baslik}</title>
<style>body{font:15px system-ui,"Segoe UI";background:#b3261e;color:#fff;margin:0;min-height:100vh;display:grid;place-items:center}
main{max-width:620px;padding:32px}.simge{font-size:56px;line-height:1}h1{font-size:26px;margin:18px 0 12px}p{line-height:1.6;opacity:.95}
.dugmeler{display:flex;gap:12px;align-items:center;margin-top:28px;flex-wrap:wrap}
.geri{background:#fff;color:#b3261e;border:0;border-radius:20px;padding:10px 22px;font:600 15px system-ui;cursor:pointer}
details{margin-top:28px;opacity:.9}summary{cursor:pointer}a{color:#fff}small{display:block;margin-top:10px;opacity:.75}</style>
<main><div class="simge">⚠</div><h1>${baslik}</h1><p>${aciklama}</p>
<p>Umbra bu sayfayı açmadı. Bu karar bilgisayarınızdaki yerel listeyle verildi; adres hiçbir yere gönderilmedi.</p>
<div class="dugmeler"><button class="geri" onclick="location.href='https://${GUVENLIK_HOST}/geri'">Güvenli sayfaya dön</button></div>
<details><summary>Ayrıntılar</summary><p>Adres: ${kac(url)}</p>
<p>Bu sitenin güvenli olduğundan eminsen <a href="https://${GUVENLIK_HOST}/devam?b=${bilet}">riski göze alıp siteye git</a>.
<small>Kaynaklar: URLhaus, Phishing Army, OpenPhish (malware-filter derlemesi)</small></p></details></main>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// Uyarıdan geri dönüş: geçmişte uyarı sayfası ve engellenen adresin kaydı da vardır; bir adım geri gitmek uyarıyı
// yeniden açar. Bu yüzden en son güvenli kayda (tehlikeli olmayan bir web sayfası) gidilir, yoksa ana sayfaya.
function guvenliSayfayaDon(wcId) {
  const s = sekmeBul(wcId);
  if (!s) return;
  const g = s.view.webContents.navigationHistory;
  for (let i = g.getActiveIndex() - 1; i >= 0; i--) {
    const adres = g.getEntryAtIndex(i)?.url || '';
    if (webAdresiMi(adres) && !guvenlik?.denetle(adres)) return g.goToIndex(i);
  }
  if (s.onceki) return geriGit(s); // geri zincirinde saklanan sayfa (ör. yeni sekme sayfası)
  git(s, veri.anaSayfa(s.tur));
}

function sekmeBul(wcId) {
  for (const s of sekmeler.values()) if (!s.view.webContents.isDestroyed() && s.view.webContents.id === wcId) return s;
  return null;
}
const guncelleyici = new Guncelleyici();
const turboAtla = new Set();           // TurboDownloader'a gönderilemeyip Umbra'ya geri verilen adresler
let panel = null, panelAcik = false, sonPanelTuru = null;
let arayuzEk = 0; // adres önerileri açıkken arayüzün sayfanın üstüne taşan yüksekliği
const oturumlar = { gizli: null, tor: null }; // bellekte tutulan, son sekme kapanınca silinen oturumlar
let torDurum = { yuzde: 0, yontem: '' };
let aktifId = null, sayac = 0, tamEkran = false, guncellemeZamanlayici = null, kapaniyor = false;
const sekmeler = new Map();
const kapatilanlar = [];               // Ctrl+Shift+T için yalnızca normal sekmelerin adresleri
const engellenen = new Map();          // webContents.id -> engellenen istek sayısı
const httpIzinli = new Set();          // kullanıcının şifresiz açmayı onayladığı alan adları
const yukseltilen = new Set();         // http -> https yükseltilen ana sayfa alan adları
const izinKararlari = new Map();       // "oturum|köken|izin" -> true/false
const canliIndirmeler = new Map();     // indirme id -> DownloadItem
const geciciIndirmeler = [];           // gizli/Tor sekmelerinden indirilenler: diske kaydedilmez

const izleyiciMi = (host) => IZLEYICILER.some((d) => host === d || host.endsWith('.' + d));
const yerelMi = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
const webAdresiMi = (url) => /^https?:\/\//i.test(url);
const googleGirisMi = (url) => /^https:\/\/accounts\.google\.com(\/|$)/i.test(url);
// Orijinal marka listesi korunur, başına Chromium sürümüyle "Google Chrome" eklenir (sayfa içindeki listeyle aynı sıra)
function chromeMarkasiEkle(deger) {
  const m = /"Chromium";v="([^"]+)"/.exec(deger || '');
  return !m || /"Google Chrome"/.test(deger) ? deger : `"Google Chrome";v="${m[1]}", ${deger}`;
}

function icSayfa(url) {
  const m = /^umbra:\/\/([\w-]+)\/?(\?.*)?$/i.exec(String(url || '').trim());
  return m && IC_SAYFALAR.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

// umbra://ara?q=... adresindeki arama sorgusu
function icSorgu(url) {
  const m = /\?(.*)$/.exec(String(url || '').trim());
  return m ? (new URLSearchParams(m[1]).get('q') || '').trim().slice(0, 500) : '';
}

// umbra://ara?q=...&zaman=hafta adresindeki zaman filtresi (Araçlar menüsü)
const ZAMANLAR = ['gun', 'hafta', 'ay', 'yil'];
function icZaman(url) {
  const m = /\?(.*)$/.exec(String(url || '').trim());
  const z = m ? new URLSearchParams(m[1]).get('zaman') : '';
  return ZAMANLAR.includes(z) ? z : '';
}

// umbra://ara?q=...&mod=gorsel adresindeki arama türü; yoksa "Tümü"
const ARAMA_MODLARI = ['ai', 'gorsel', 'video', 'haber'];
function icMod(url) {
  const m = /\?(.*)$/.exec(String(url || '').trim());
  const d = m ? new URLSearchParams(m[1]).get('mod') : '';
  return ARAMA_MODLARI.includes(d) ? d : '';
}

// Sorgu, zaman ve arama türü umbra://ara adresinin parametreleridir
function icParametre(s) {
  if (!s.icSorgu) return null;
  return new URLSearchParams({ q: s.icSorgu, ...(s.icMod ? { mod: s.icMod } : {}), ...(s.icZaman ? { zaman: s.icZaman } : {}) });
}

function icYukle(wc, sayfa, s) {
  const p = icParametre(s);
  wc.loadFile(path.join(__dirname, 'ic', 'index.html'), { hash: sayfa, ...(p ? { query: Object.fromEntries(p) } : {}) });
}

function kokeni(url) {
  try { return new URL(url).origin; } catch { return url; }
}

function temizUserAgent(ua) {
  return ua.split(' ').filter((t) => !/^(Electron|Umbra|umbra)\//.test(t)).join(' ');
}

function benzersizYol(klasor, ad) {
  const uzanti = path.extname(ad);
  const govde = path.basename(ad, uzanti) || 'indirilen';
  let yol = path.join(klasor, govde + uzanti);
  for (let n = 1; fs.existsSync(yol); n++) yol = path.join(klasor, `${govde} (${n})${uzanti}`);
  return yol;
}

function sertlestir(ses, etiket) {
  // Dil listesi gerçek Chrome'daki gibi; Tor sekmelerinde parmak izini azaltmak için Tor Browser gibi yalnızca İngilizce
  ses.setUserAgent(temizUserAgent(ses.getUserAgent()), etiket === 'tor' ? 'en-US,en' : 'tr-TR,tr,en-US,en');
  ses.setSpellCheckerEnabled(false);

  // Google, giriş sayfasında marka listesinde "Google Chrome" (ya da bilinen başka bir tarayıcı) olmayan Chromium
  // tarayıcılarını "güvenli olmayabilir" diye reddeder. Umbra'nın motoru zaten Chromium olduğu için yalnızca o sayfada
  // marka listesine Chrome'un adı eklenir; motor ve söylenen kimlik tutarlı kalır.
  ses.webRequest.onBeforeSendHeaders((ayr, cb) => {
    if (!googleGirisMi(ayr.url)) return cb({});
    const basliklar = { ...ayr.requestHeaders };
    for (const ad of Object.keys(basliklar)) {
      if (/^sec-ch-ua(-full-version-list)?$/i.test(ad)) basliklar[ad] = chromeMarkasiEkle(basliklar[ad]);
    }
    cb({ requestHeaders: basliklar });
  });

  ses.webRequest.onBeforeRequest((ayr, cb) => {
    let u;
    try { u = new URL(ayr.url); } catch { return cb({}); }
    // Uyarı sayfasındaki bağlantılar
    if (u.hostname === GUVENLIK_HOST) {
      const bilet = devamBiletleri.get(u.searchParams.get('b') || '');
      if (u.pathname === '/devam' && bilet) {
        devamBiletleri.delete(u.searchParams.get('b'));
        try { riskKabul.add(`${etiket}|${new URL(bilet.url).hostname}`); } catch {}
        return cb({ redirectURL: bilet.url });
      }
      cb({ cancel: true });
      if (u.pathname === '/geri') setImmediate(() => guvenliSayfayaDon(ayr.webContentsId));
      return;
    }
    // Dolandırıcılık / zararlı yazılım sitesi: sayfa açılmaz, yerine uyarı gösterilir (did-fail-load'da)
    if ((ayr.resourceType === 'mainFrame' || ayr.resourceType === 'subFrame') && veri.ayarlar.dolandiricilikKorumasi && guvenlik) {
      const tehlike = guvenlik.denetle(ayr.url);
      if (tehlike && !riskKabul.has(`${etiket}|${u.hostname}`)) {
        if (ayr.resourceType === 'mainFrame') guvenlikEngeli.set(ayr.webContentsId, { url: ayr.url, tur: tehlike.tur });
        return cb({ cancel: true });
      }
    }
    if (ayr.resourceType !== 'mainFrame' && veri.ayarlar.izleyiciEngelle && izleyiciMi(u.hostname)) {
      engellenen.set(ayr.webContentsId, (engellenen.get(ayr.webContentsId) || 0) + 1);
      arayuzuGuncelle();
      return cb({ cancel: true });
    }
    // .onion adresleri Tor içinde zaten uçtan uca şifrelidir, https'e yükseltilmez
    if (u.protocol === 'http:' && !yerelMi(u.hostname) && !u.hostname.endsWith('.onion') && !httpIzinli.has(u.hostname)) {
      if (ayr.resourceType === 'mainFrame') yukseltilen.add(u.hostname);
      u.protocol = 'https:';
      return cb({ redirectURL: u.toString() });
    }
    cb({});
  });

  ses.setPermissionRequestHandler(async (wc, izin, cb, ayr) => {
    if (OTOMATIK_IZINLER.has(izin)) return cb(true);
    if (!SORULAN_IZINLER[izin]) return cb(false);
    const koken = kokeni(ayr.requestingUrl || wc.getURL());
    const anahtar = `${etiket}|${koken}|${izin}`;
    if (izinKararlari.has(anahtar)) return cb(izinKararlari.get(anahtar));
    const { response, checkboxChecked } = await dialog.showMessageBox(pencere, {
      type: 'question',
      title: 'İzin isteği',
      message: `${koken} şuna erişmek istiyor: ${SORULAN_IZINLER[izin]}`,
      buttons: ['İzin verme', 'İzin ver'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: 'Bu site için kararımı hatırla',
    });
    const karar = response === 1;
    if (checkboxChecked) izinKararlari.set(anahtar, karar);
    cb(karar);
  });
  ses.setPermissionCheckHandler((_wc, izin, koken) =>
    OTOMATIK_IZINLER.has(izin) || izinKararlari.get(`${etiket}|${koken}|${izin}`) === true);
  ses.setDevicePermissionHandler(() => false); // USB / HID / seri port erişimi kapalı

  // TurboDownloader için sayfadaki video/ses akışlarını yakala (yalnızca normal oturum)
  if (etiket === 'normal') {
    ses.webRequest.onHeadersReceived((ayr, cb) => {
      if (turbo.yanitIncele(ayr)) arayuzuGuncelle();
      cb({});
    });
  }

  ses.on('will-download', (e, item, wc) => {
    const ad = item.getFilename();
    const url = item.getURL();
    // Zararlı yazılım yaydığı bilinen bir yerden gelen indirme hiç başlatılmaz
    const tehlike = veri.ayarlar.dolandiricilikKorumasi && guvenlik?.denetle(url);
    if (tehlike) {
      e.preventDefault();
      dialog.showMessageBox(pencere, {
        type: 'error',
        title: 'İndirme engellendi',
        message: `"${ad}" indirilmedi.`,
        detail: `${kokeni(url)} ${tehlike.tur === 'oltalama' ? 'bilinen bir dolandırıcılık sitesi' : 'zararlı yazılım yaydığı bilinen bir site'}. Dosya bilgisayarınıza zarar verebilir.`,
      });
      return;
    }
    if (RISKLI_DOSYA.test(ad)) {
      const secim = dialog.showMessageBoxSync(pencere, {
        type: 'warning',
        title: 'Riskli dosya',
        message: `"${ad}" bilgisayarınızda çalıştırılabilen bir dosya.`,
        detail: `Kaynak: ${kokeni(item.getURL())}\nYalnızca güvendiğiniz kaynaklardan indirin.`,
        buttons: ['İptal', 'Yine de indir'],
        defaultId: 0,
        cancelId: 0,
      });
      if (secim !== 1) return item.cancel();
    }
    // TurboDownloader gerçek IP ile indirir: yalnızca normal oturumda ve uygulama açıkken devredilir
    if (etiket === 'normal' && veri.ayarlar.turboIndir && turboKullanilabilir() && webAdresiMi(url) && !turboAtla.has(url)) {
      e.preventDefault();
      const referer = wc && !wc.isDestroyed() ? wc.getURL() : '';
      turbo.gonder(ses, { url, referer, filename: ad })
        .then(() => turboKaydi(ad, url))
        .catch(() => {
          // Uygulamaya ulaşılamadı: indirmeyi Umbra'nın kendisine geri ver
          turboAtla.add(url);
          const hedef = wc && !wc.isDestroyed() ? wc : aktifWc();
          hedef?.downloadURL(url);
        });
      return;
    }
    turboAtla.delete(url);
    item.setSavePath(benzersizYol(app.getPath('downloads'), ad));
    indirmeyiIzle(item, etiket !== 'normal');
  });
}

// --- İndirmeler ---
let indirmeZamanlayici = null;
function indirmeDegisti() {
  if (indirmeZamanlayici) return;
  indirmeZamanlayici = setTimeout(() => {
    indirmeZamanlayici = null;
    arayuzuGuncelle();
    icSayfalaraBildir('indirilenler');
  }, 250);
}

function tumIndirmeler() {
  return [...geciciIndirmeler, ...veri.indirilenler].sort((a, b) => b.zaman - a.zaman);
}

function indirmeyiIzle(item, gecici) {
  const yol = item.getSavePath();
  const kayit = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dosya: path.basename(yol), yol, url: item.getURL(),
    boyut: item.getTotalBytes(), alinan: 0, durum: 'iniyor', zaman: Date.now(), gecici,
  };
  (gecici ? geciciIndirmeler : veri.indirilenler).unshift(kayit);
  canliIndirmeler.set(kayit.id, item);
  item.on('updated', () => {
    kayit.alinan = item.getReceivedBytes();
    kayit.boyut = item.getTotalBytes();
    kayit.duraklatildi = item.isPaused();
    indirmeDegisti();
  });
  item.once('done', (_e, durum) => {
    kayit.alinan = item.getReceivedBytes();
    kayit.durum = durum === 'completed' ? 'tamam' : durum === 'cancelled' ? 'iptal' : 'hata';
    canliIndirmeler.delete(kayit.id);
    if (!gecici) veri.indirmeKaydet();
    indirmeDegisti();
  });
  if (!gecici) veri.indirmeKaydet();
  indirmeDegisti();
}

function turboKaydi(ad, url) {
  veri.indirilenler.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dosya: ad, yol: '', url, boyut: 0, alinan: 0, durum: 'turbo', zaman: Date.now(),
  });
  veri.indirmeKaydet();
  indirmeDegisti();
}

// TurboDownloader açıksa ya da bu bilgisayarda kuruluysa (kapalıysa ilk kullanımda başlatılır) kullanılabilir
const turboKullanilabilir = () => turbo.acik || turbo.kurulu();
// Video üstündeki "İndir ▼" düğmesi: kullanıcı ayarı açık ve TurboDownloader kullanılabilirse görünür
const turboDugmesiEtkin = () => veri.ayarlar.turboIndir && turboKullanilabilir();

function turboHatasi(h) {
  dialog.showMessageBox(pencere, {
    type: 'error', title: 'TurboDownloader',
    message: 'İndirme TurboDownloader\'a gönderilemedi.',
    detail: `${h.message}\nTurboDownloader kurulu değilse veya açılamıyorsa indirmeyi Umbra'nın kendi indiricisiyle yapabilirsin.`,
  });
}

// Sağ tık / medya menüsünden TurboDownloader'a gönderim; yalnızca normal sekmelerden çağrılır
async function turboyaGonder(s, secenek, kayitAdi) {
  if (!s || s.tur !== 'normal') return;
  try {
    await turbo.gonder(s.view.webContents.session, secenek);
    turboKaydi(kayitAdi, secenek.url || secenek.pageUrl);
  } catch (h) {
    turboHatasi(h);
  }
}

// Sayfanın videosu/sesi (kalite seçimiyle ya da en iyi kalitede)
async function turboSayfaGonder(s, { mode = 'video', quality = 0, source = '', src = '' } = {}) {
  if (!s || s.tur !== 'normal') throw new Error('yalnızca normal sekmelerde kullanılabilir');
  const wc = s.view.webContents;
  const sayfa = wc.getURL();
  if (!webAdresiMi(sayfa)) throw new Error('bu sayfa indirilemez');
  await turbo.sayfaGonder(wc.session, wc.id, sayfa, { mode, quality, source, src });
  turboKaydi(`${mode === 'audio' ? 'MP3' : 'Video'}${quality ? ` (${quality}${mode === 'audio' ? ' kbps' : 'p'})` : ''}: ${wc.getTitle() || sayfa}`, source || sayfa);
}

// Kalite listesini TurboDownloader'dan alıp seçim menüsü gösterir (yt-dlp çözümlemesi birkaç saniye sürebilir)
async function kaliteMenusu(s, konum) {
  if (!s || s.tur !== 'normal') return;
  const wc = s.view.webContents;
  const goster = (ogeler) => Menu.buildFromTemplate(ogeler).popup({ window: pencere, ...(konum || {}) });
  const dene = (secenek) => () => turboSayfaGonder(s, secenek).catch(turboHatasi);
  const veriler = await turbo.formatlar(wc.session, wc.id, wc.getURL());
  if (veriler.error || !Array.isArray(veriler.options)) {
    return goster([
      { label: `Kaliteler alınamadı: ${String(veriler.error || 'bilinmeyen yanıt').slice(0, 80)}`, enabled: false },
      { type: 'separator' },
      { label: 'En iyi kalitede dene', click: dene({ mode: 'video', quality: 0 }) },
      { label: 'MP3 olarak dene', click: dene({ mode: 'audio', quality: 320 }) },
    ]);
  }
  const boyut = (b) => (b ? `   ~${b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB'}` : '');
  const ogeler = [{ label: String(veriler.title || wc.getTitle()).slice(0, 70), enabled: false }];
  const videolar = veriler.options.filter((o) => o.kind === 'video');
  const sesler = veriler.options.filter((o) => o.kind === 'audio');
  if (videolar.length) {
    ogeler.push({ type: 'separator' }, { label: 'Video (MP4)', enabled: false });
    for (const o of videolar) ogeler.push({ label: `${o.label}${boyut(o.size)}`, click: dene({ mode: 'video', quality: o.q, source: veriler.source }) });
  }
  if (sesler.length) {
    ogeler.push({ type: 'separator' }, { label: 'Ses', enabled: false });
    for (const o of sesler) ogeler.push({ label: `${o.label}${boyut(o.size)}`, click: dene({ mode: 'audio', quality: o.q, source: veriler.source }) });
  }
  goster(ogeler);
}

function turboMenuOgeleri(s, p, konum) {
  if (!s || s.tur !== 'normal' || !turboKullanilabilir()) return [];
  const wc = s.view.webContents;
  const sayfa = p?.frameURL || wc.getURL();
  if (!webAdresiMi(sayfa)) return [];
  const ogeler = [];
  if (p?.linkURL && webAdresiMi(p.linkURL)) {
    ogeler.push(
      { label: '⚡ TurboDownloader ile indir', click: () => turboyaGonder(s, { url: p.linkURL, referer: sayfa }, p.linkURL.split('/').pop() || p.linkURL) },
      { label: '⚡ Bağlantıyı MP3 olarak indir', click: () => turboyaGonder(s, { url: p.linkURL, pageUrl: p.linkURL, mode: 'audio', referer: sayfa }, 'MP3: ' + p.linkURL) },
    );
  }
  if (['video', 'audio', 'image'].includes(p?.mediaType) && webAdresiMi(p.srcURL)) {
    ogeler.push({ label: '⚡ Bu medyayı TurboDownloader ile indir', click: () => turboyaGonder(s, { url: p.srcURL, referer: sayfa, mediaHint: true }, p.srcURL.split('/').pop() || p.srcURL) });
  }
  ogeler.push(
    { label: '⚡ Bu sayfanın videosunu indir (kalite seç…)', click: () => kaliteMenusu(s, konum) },
    { label: '⚡ Bu sayfanın videosunu en iyi kalitede indir', click: () => turboSayfaGonder(s, { mode: 'video' }).catch(turboHatasi) },
    { label: '⚡ Bu sayfanın sesini MP3 indir', click: () => turboSayfaGonder(s, { mode: 'audio', quality: 320 }).catch(turboHatasi) },
  );
  return ogeler;
}

function medyaMenusu(x, y) {
  const s = aktifSekme();
  const ogeler = turboMenuOgeleri(s, null, { x: Math.round(x), y: Math.round(y) });
  if (!ogeler.length) return;
  const sayfa = s.view.webContents.getURL();
  const liste = turbo.medyaListesi(s.view.webContents.id);
  if (liste.length) ogeler.push({ type: 'separator' }, { label: 'Yakalanan medya', enabled: false });
  const kb = (b) => (b ? ` · ${(b / 1048576).toFixed(1)} MB` : '');
  for (const m of liste.slice(0, 15)) {
    ogeler.push({
      label: `${m.tur === 'ses' ? '♪' : m.tur === 'akış' ? '📡' : '🎞'} ${m.ad.slice(0, 60)}${kb(m.boyut)}`,
      submenu: [
        {
          label: 'İndir',
          click: () => turboyaGonder(s, m.tur === 'akış'
            ? { url: m.url, pageUrl: m.url, mode: 'video', referer: sayfa }
            : { url: m.url, referer: sayfa, mediaHint: true }, m.ad),
        },
        { label: 'MP3 olarak indir', click: () => turboyaGonder(s, { url: m.url, pageUrl: m.url, mode: 'audio', referer: sayfa }, 'MP3: ' + m.ad) },
      ],
    });
  }
  ogeler.push({ type: 'separator' }, { label: 'TurboDownloader penceresini aç', click: () => turbo.goster().catch(() => {}) });
  Menu.buildFromTemplate(ogeler).popup({ window: pencere, x: Math.round(x), y: Math.round(y) });
}

async function indirmeEylemi(eylem, id) {
  const kayit = tumIndirmeler().find((i) => i.id === id);
  if (!kayit) return;
  if (eylem === 'iptal') canliIndirmeler.get(id)?.cancel();
  else if (eylem === 'klasor') shell.showItemInFolder(kayit.yol);
  else if (eylem === 'ac' && kayit.durum === 'tamam') {
    if (!fs.existsSync(kayit.yol)) return { hata: 'Dosya taşınmış veya silinmiş.' };
    if (RISKLI_DOSYA.test(kayit.yol)) {
      const { response } = await dialog.showMessageBox(pencere, {
        type: 'warning', title: 'Dosyayı çalıştır',
        message: `"${kayit.dosya}" bir program. Çalıştırmak istediğinizden emin misiniz?`,
        detail: `Kaynak: ${kokeni(kayit.url)}`,
        buttons: ['Vazgeç', 'Çalıştır'], defaultId: 0, cancelId: 0,
      });
      if (response !== 1) return;
    }
    const hata = await shell.openPath(kayit.yol);
    if (hata) return { hata };
  } else if (eylem === 'sil') {
    canliIndirmeler.get(id)?.cancel();
    const liste = kayit.gecici ? geciciIndirmeler : veri.indirilenler;
    liste.splice(liste.indexOf(kayit), 1);
    if (!kayit.gecici) veri.indirmeKaydet();
  }
  indirmeDegisti();
}

// --- Oturumlar ---
function oturumAl(tur) {
  if (tur === 'normal') return normalOturum;
  if (!oturumlar[tur]) {
    // "persist:" öneki olmadığı için her şey yalnızca bellekte tutulur
    const ses = session.fromPartition(`${tur}-${Date.now()}`);
    sertlestir(ses, tur);
    if (tur === 'tor') ses.setProxy(KAPALI_PROXY);
    oturumlar[tur] = ses;
  }
  return oturumlar[tur];
}

function oturumuTemizle(tur) {
  const ses = oturumlar[tur];
  if (!ses) return;
  ses.clearStorageData();
  ses.clearCache();
  for (const k of izinKararlari.keys()) if (k.startsWith(tur + '|')) izinKararlari.delete(k);
  geciciIndirmeler.splice(0, geciciIndirmeler.length, ...geciciIndirmeler.filter((i) => i.durum === 'iniyor'));
  oturumlar[tur] = null;
}

async function toraHazirla(ses) {
  const port = await tor.baglan();
  await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
}

function bilgiSayfasi(baslik, aciklama) {
  const html = `<!doctype html><meta charset="utf-8"><title>${baslik}</title>
<style>body{font:16px system-ui;background:#16302b;color:#e6f2ee;display:grid;place-items:center;height:90vh;margin:0}
div{max-width:560px;padding:24px;text-align:center}.d{width:36px;height:36px;margin:0 auto 20px;border:4px solid #ffffff33;
border-top-color:#7ee2c4;border-radius:50%;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style>
<div><div class="d"></div><h1 style="font-size:22px">${baslik}</h1><p>${aciklama}</p></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function hataSayfasi(baslik, aciklama) {
  const kac = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>${kac(baslik)}</title>
<style>body{font:16px system-ui;background:#f4f5f7;color:#222;display:grid;place-items:center;height:90vh;margin:0}
div{max-width:560px;padding:24px}h1{font-size:22px}code{color:#b42318}</style>
<div><h1>${kac(baslik)}</h1><p>${kac(aciklama)}</p></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function adreseCevir(girdi, tur = 'normal') {
  const t = String(girdi || '').trim();
  if (!t) return null;
  if (webAdresiMi(t)) return t;
  if (icSayfa(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t)) return 'http://' + t;
  if (!/\s/.test(t) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) return 'https://' + t;
  if (t.startsWith('?')) return t.slice(1).trim() ? veri.aramaAdresi(t.slice(1).trim(), tur) : null; // "?kelime" her zaman arar
  // Tek kelime ("youtube"): geçmişte/bilinen sitelerde karşılığı varsa doğrudan o siteye git
  const site = veri.siteTahmini(t);
  if (site) return site;
  return veri.aramaAdresi(t, tur);
}

function aktifSekme() {
  return sekmeler.get(aktifId);
}

function aktifWc() {
  return aktifSekme()?.view.webContents;
}

function sekmeAdresi(s) {
  if (s.tur === 'ic') {
    const p = icParametre(s);
    return `umbra://${s.icSayfa}${p ? '?' + p : ''}`;
  }
  if (s.torBekliyor) return '';
  const gercek = s.view.webContents.getURL();
  if (gercek.startsWith('file:')) return ''; // gizli/Tor başlangıç sayfasında adres çubuğu boş kalır
  if (!gercek) return s.istenenAdres || ''; // henüz yüklenmemiş (ör. arka planda açılmış) sekme
  return s.hataAdresi && gercek.startsWith('data:') ? s.hataAdresi : gercek;
}

function yerlesim() {
  if (!pencere) return;
  const { width, height } = pencere.getContentBounds();
  const ust = tamEkran ? 0 : ustYukseklik();
  const panelG = panelAcik && !tamEkran ? Math.min(PANEL_GENISLIK, Math.floor(width / 2)) : 0;
  if (panel) panel.setBounds({ x: width - panelG, y: ust, width: panelG, height: Math.max(0, height - ust) });
  const s = aktifSekme();
  if (s) s.view.setBounds({ x: 0, y: ust, width: width - panelG, height: Math.max(0, height - ust) });
  // Öneri listesi ya da yıldız penceresi açıkken arayüz, sayfanın üstüne çıkabilmesi için en öne alınır.
  // (Önce öne alınır, sonra boyutlanır: tersi sırada yeniden eklenen görünüm yeni boyutu almayabiliyor.)
  if (arayuzEk) pencere.contentView.addChildView(arayuz);
  arayuz.setBounds({ x: 0, y: 0, width, height: tamEkran ? 0 : Math.min(height, ust + arayuzEk) });
}

// --- AI paneli ---
function panelAc(ac = !panelAcik) {
  panelAcik = ac;
  if (ac && !panel) {
    panel = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'panel', 'preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    panel.webContents.loadFile(path.join(__dirname, 'panel', 'index.html'));
    panel.webContents.on('did-finish-load', () => { sonPanelTuru = null; arayuzuGuncelle(); });
  }
  if (panel) {
    if (ac) pencere.contentView.addChildView(panel);
    else pencere.contentView.removeChildView(panel);
  }
  yerlesim();
  if (ac) panel.webContents.focus();
  else aktifWc()?.focus();
  arayuzuGuncelle();
}

// Panel açıksa soruyu hemen, yeni açılıyorsa yüklendikten sonra gönderir
function panelaSor(soru) {
  const yeni = !panel;
  panelAc(true);
  if (yeni || panel.webContents.isLoading()) {
    panel.webContents.once('did-finish-load', () => panel.webContents.send('ai:hazir-soru', soru));
  } else {
    panel.webContents.send('ai:hazir-soru', soru);
  }
}

async function sayfaMetni(s) {
  const wc = s.view.webContents;
  // Sayfanın kendi betiklerinden yalıtılmış bir dünyada okunur
  const metin = await wc.executeJavaScriptInIsolatedWorld(1000, [{ code: 'document.body ? document.body.innerText : ""' }]);
  return { baslik: wc.getTitle(), url: wc.getURL(), metin: String(metin || '') };
}

function arayuzuGuncelle() {
  if (guncellemeZamanlayici) return;
  guncellemeZamanlayici = setTimeout(() => {
    guncellemeZamanlayici = null;
    if (!arayuz || arayuz.webContents.isDestroyed()) return;
    const liste = [...sekmeler.values()].filter((s) => !s.view.webContents.isDestroyed()).map((s) => {
      const wc = s.view.webContents;
      const url = sekmeAdresi(s);
      const hatada = Boolean(s.hataAdresi && wc.getURL().startsWith('data:'));
      const torBaslik = torDurum.yuzde
        ? `Tor: %${torDurum.yuzde} (${YONTEM_ADLARI[torDurum.yontem] || ''})`
        : 'Tor ağına bağlanıyor…';
      return {
        id: s.id,
        baslik: s.torBekliyor ? torBaslik : (hatada ? 'Hata' : wc.getTitle()) || url || 'Yeni sekme',
        hatada,
        url,
        favicon: s.tur === 'ic' ? 'logo-kucuk.png' : s.favicon || '',
        yukleniyor: s.torBekliyor || wc.isLoading(),
        geri: wc.navigationHistory.canGoBack() || Boolean(s.onceki),
        ileri: wc.navigationHistory.canGoForward() || Boolean(s.sonraki),
        tur: s.tur,
        guvenli: !hatada && url.startsWith('https://'),
        engellenen: engellenen.get(wc.id) || 0,
        yerImi: webAdresiMi(url) && veri.yerImiMi(url),
        medya: s.tur === 'normal' && turboKullanilabilir() ? turbo.medyaListesi(wc.id).length : -1,
        aktif: s.id === aktifId,
      };
    });
    const iniyor = tumIndirmeler().filter((i) => i.durum === 'iniyor');
    const toplam = iniyor.reduce((t, i) => t + (i.boyut || 0), 0);
    const alinan = iniyor.reduce((t, i) => t + (i.alinan || 0), 0);
    // Başlık çubuğu görünmez ama görev çubuğunda ve Alt+Tab'da etkin sekmenin başlığı görünür (Chrome'daki gibi)
    const etkin = liste.find((x) => x.aktif);
    if (pencere && etkin) pencere.setTitle(`${etkin.baslik} - Umbra`);
    arayuz.webContents.send('tabs:update', {
      sekmeler: liste,
      aiAcik: panelAcik,
      indirme: { var: tumIndirmeler().length > 0, aktif: iniyor.length, yuzde: toplam ? Math.round((alinan / toplam) * 100) : null },
      guncelleme: guncelleyici.durum,
      // Yer işaretleri çubuğu (kapalıysa null)
      cubuk: veri.ayarlar.yerImiCubugu ? veri.cubuktakiler().map((y) => ({ id: y.id, baslik: y.baslik, url: y.url })) : null,
    });
    const tur = aktifSekme()?.tur;
    if (panel && tur !== sonPanelTuru && !panel.webContents.isLoading()) {
      sonPanelTuru = tur;
      panel.webContents.send('ai:sekme', { tur });
    }
  }, 50);
}

function oturumuKaydet() {
  if (kapaniyor) return;
  const adresler = [...sekmeler.values()]
    .filter((s) => s.tur === 'normal' || s.tur === 'ic')
    .map(sekmeAdresi)
    .filter((u) => webAdresiMi(u) || icSayfa(u))
    // Arama sonuçları sorgusuz saklanır: her açılışta aynı aramalar yeniden yapılıp ücretlendirilmesin
    .map((u) => (icSayfa(u) === 'ara' ? 'umbra://ara' : u));
  veri.oturumKaydet(adresler);
}

function sirayaKoy(id, konum) {
  const girdiler = [...sekmeler.entries()];
  const i = girdiler.findIndex(([k]) => k === id);
  const [girdi] = girdiler.splice(i, 1);
  girdiler.splice(konum, 0, girdi);
  sekmeler.clear();
  for (const [k, v] of girdiler) sekmeler.set(k, v);
}

function sekmeAc(url, tur = 'normal', { konum = null, arkaPlanda = false } = {}) {
  url = url || veri.anaSayfa(tur);
  const ic = icSayfa(url);
  if (ic) tur = 'ic';
  const id = ++sayac;
  const ses = tur === 'ic' ? session.defaultSession : oturumAl(tur);
  const webTercihleri = tur === 'ic'
    ? { preload: path.join(__dirname, 'ic', 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    : {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false,
        // Video üstündeki "İndir ▼" düğmesi yalnızca normal sekmelerde; gizli ve Tor sekmelerine hiçbir kod eklenmez
        ...(tur === 'normal' ? { preload: path.join(__dirname, 'sekme', 'preload.js') } : {}),
      };
  const view = new WebContentsView({ webPreferences: webTercihleri });
  view.setBackgroundColor(tur === 'ic' ? '#1f2228' : '#ffffff');
  const sekme = { id, view, tur, icSayfa: ic, icSorgu: ic ? icSorgu(url) : '', icZaman: ic ? icZaman(url) : '', icMod: ic ? icMod(url) : '', istenenAdres: url, favicon: '', hataAdresi: null, torBekliyor: false, bekleyenAdres: null };
  sekmeler.set(id, sekme);
  if (konum !== null) sirayaKoy(id, konum);
  const wc = view.webContents;
  // WebRTC, proxy'yi atlayıp gerçek IP adresini sızdırabilir; Tor sekmelerinde yalnızca proxy üzerinden izin verilir
  if (tur === 'tor') wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.on('preload-error', (_e, yol, h) => console.error('Sekme ön yükleme hatası', yol, h));

  wc.setWindowOpenHandler(({ url: yeni, disposition }) => {
    if (!webAdresiMi(yeni) || tur === 'ic') return { action: 'deny' };
    // Boyut belirtilerek açılan pencereler (Google/Apple ile giriş gibi) Chrome'daki gibi gerçek açılır pencere olur:
    // giriş sayfası sonucu kendisini açan sayfaya (window.opener) bildirir; sekmeye çevrilirse bu bağ kopar ve
    // site onay beklerken takılır kalır. Açılır pencere aynı oturumu ve güvenlik ayarlarını devralır.
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon: SIMGE,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          minimizable: false,
          fullscreenable: false,
          // Sekmeyle aynı oturum, aynı güvenlik ayarları ve aynı ön yükleme (Google giriş düzeltmesi dahil)
          webPreferences: webTercihleri,
        },
      };
    }
    sekmeAc(yeni, tur, { arkaPlanda: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (acilir) => {
    acilir.setMenuBarVisibility(false);
    // Açılır penceredeki bağlantılar yeni pencere değil, aynı türde sekme açar
    acilir.webContents.setWindowOpenHandler(({ url: yeni }) => {
      if (webAdresiMi(yeni)) sekmeAc(yeni, tur);
      return { action: 'deny' };
    });
    if (tur === 'tor') acilir.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  });

  for (const olay of ['did-start-loading', 'did-stop-loading']) wc.on(olay, arayuzuGuncelle);
  wc.on('page-title-updated', (_e, baslik) => {
    if (tur === 'normal' && webAdresiMi(wc.getURL())) veri.basligiGuncelle(wc.getURL(), baslik);
    arayuzuGuncelle();
  });
  wc.on('did-start-navigation', (ayr) => {
    if (ayr.isMainFrame && !ayr.isSameDocument) {
      engellenen.set(wc.id, 0);
      turbo.temizle(wc.id);
      sekme.favicon = '';
      if (!ayr.url.startsWith('data:')) sekme.hataAdresi = null;
    }
  });
  const gezindi = (adres) => {
    // Geri dönülmüş bir sayfadan yeni bir yere gidilince (geçmişin sonunda yeni kayıt) saklı "ileri" sayfası silinir.
    // Yalnızca görünen sekmede: arkada saklanan bir sayfa kendi adresini güncellerse (ör. pushState) bu bir gezinme sayılmaz.
    if (sekme.sonraki && !sekme.gecmisGezinme && sekmeler.get(sekme.id) === sekme) {
      const g = wc.navigationHistory;
      if (g.getActiveIndex() === g.length() - 1) zinciriKapat(sekme, 'sonraki');
    }
    sekme.gecmisGezinme = false;
    // Gizli ve Tor sekmelerinde geçmiş tutulmaz
    if (tur === 'normal' && webAdresiMi(adres)) veri.gecmiseEkle(adres, wc.getTitle());
    oturumuKaydet();
    arayuzuGuncelle();
  };
  wc.on('did-navigate', (_e, adres) => gezindi(adres));
  wc.on('did-navigate-in-page', (_e, adres, anaCerceve) => { if (anaCerceve) gezindi(adres); });
  wc.on('page-favicon-updated', (_e, ikonlar) => {
    sekme.favicon = ikonlar.find((i) => i.startsWith('https://')) || '';
    arayuzuGuncelle();
  });
  wc.on('found-in-page', (_e, sonuc) => {
    if (sekme.id === aktifId && sonuc.finalUpdate) {
      arayuz.webContents.send('bul:sonuc', { aktif: sonuc.activeMatchOrdinal, toplam: sonuc.matches });
    }
  });

  wc.on('did-fail-load', async (_e, kod, aciklama, adres, anaCerceve) => {
    if (!anaCerceve || kod === -3 || tur === 'ic') return; // -3: kullanıcı iptal etti / yönlendirme
    if (adres.includes(GUVENLIK_HOST)) return; // uyarı sayfasının kendi bağlantısı (geri dönüş ayrıca yapılır)
    const engel = guvenlikEngeli.get(wc.id);
    if (engel) {
      guvenlikEngeli.delete(wc.id);
      sekme.hataAdresi = engel.url;
      return wc.loadURL(guvenlikUyarisi(engel.url, engel.tur));
    }
    let host = '';
    try { host = new URL(adres).hostname; } catch {}
    if (adres.startsWith('https://') && yukseltilen.has(host)) {
      yukseltilen.delete(host);
      const { response } = await dialog.showMessageBox(pencere, {
        type: 'warning',
        title: 'Güvenli bağlantı kurulamadı',
        message: `${host} güvenli (HTTPS) bağlantıyı desteklemiyor.`,
        detail: 'Şifresiz HTTP ile devam ederseniz bu sitede gönderdiğiniz bilgiler başkaları tarafından görülebilir.',
        buttons: ['Vazgeç', 'Şifresiz devam et'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1) {
        httpIzinli.add(host);
        return wc.loadURL(adres.replace(/^https:/, 'http:'));
      }
    }
    sekme.hataAdresi = adres;
    const sertifika = kod <= -200 && kod > -300;
    wc.loadURL(hataSayfasi(
      sertifika ? 'Bağlantı güvenli değil' : 'Sayfa açılamadı',
      sertifika
        ? `${host} geçerli bir güvenlik sertifikası sunmadı (${aciklama}). Saldırganlar bilgilerinizi çalmaya çalışıyor olabilir, bu yüzden sayfa engellendi.`
        : `${adres} yüklenemedi (${aciklama}).`,
    ));
  });

  wc.on('enter-html-full-screen', () => { tamEkran = true; pencere.setFullScreen(true); yerlesim(); });
  wc.on('leave-html-full-screen', () => { tamEkran = false; pencere.setFullScreen(false); yerlesim(); });
  if (tur !== 'ic') wc.on('context-menu', (_e, p) => sagTikMenusu(wc, p, tur));

  if (tur === 'ic') {
    icYukle(wc, ic, sekme);
  } else if (tur === 'tor') {
    sekme.torBekliyor = true;
    sekme.bekleyenAdres = url;
    wc.loadURL(bilgiSayfasi('Tor ağına bağlanılıyor',
      'Engel varsa köprüler otomatik denenir; bu işlem bir dakikayı bulabilir. Bağlantı kurulana kadar bu sekmeden hiçbir veri gönderilmez.'));
    toraHazirla(ses).then(() => {
      if (wc.isDestroyed()) return;
      sekme.torBekliyor = false;
      if (sekme.bekleyenAdres === OZEL_BASLANGIC) ozelBaslangicYukle(wc, 'tor');
      else wc.loadURL(sekme.bekleyenAdres);
    }).catch((h) => {
      if (wc.isDestroyed()) return;
      sekme.torBekliyor = false;
      sekme.hataAdresi = sekme.bekleyenAdres;
      wc.loadURL(hataSayfasi('Tor ağına bağlanılamadı', h.message + ' İnternet bağlantınızı kontrol edip yeni bir Tor sekmesi açın.'));
    });
  } else if (url === OZEL_BASLANGIC) {
    ozelBaslangicYukle(wc, tur);
  } else {
    wc.loadURL(url);
  }
  if (arkaPlanda && aktifId !== null) arayuzuGuncelle();
  else sekmeyeGec(id);
  // Yeni sekmede imleç Chrome'daki gibi adres çubuğunda olur
  // (Sayfa yüklenince Chromium odağı sekmeye verir; bu yüzden yükleme bitince bir kez daha adres çubuğuna alınır.)
  if (!arkaPlanda && url === veri.anaSayfa(tur === 'ic' ? 'normal' : tur)) {
    adresCubugunaOdaklan();
    wc.once('did-finish-load', () => { if (!wc.isDestroyed() && aktifWc() === wc) adresCubugunaOdaklan(); });
  }
  oturumuKaydet();
  return id;
}

// Gizli/Tor sekmelerinin yerel başlangıç sayfası. Sekmenin kendi (gizli/Tor) oturumunda, köprüsüz açılır;
// içindeki arama kutusu doğrudan seçili izleyicisiz arama motoruna gider.
function ozelBaslangicYukle(wc, tur) {
  const m = veri.ozelMotor();
  wc.loadFile(path.join(__dirname, 'ic', 'baslangic.html'), { query: { tur, ara: m.ara, ad: m.ad } });
}

// Bir sekmede adres açar; sekme türü (iç sayfa / web) değişiyorsa aynı konumda yeni sekmeyle değiştirir
function git(s, url) {
  if (!s || !url) return;
  if (url === OZEL_BASLANGIC) {
    if (s.tur !== 'gizli' && s.tur !== 'tor') url = 'umbra://ara';
    else if (s.torBekliyor) { s.bekleyenAdres = url; return; }
    else return ozelBaslangicYukle(s.view.webContents, s.tur);
  }
  const ic = icSayfa(url);
  if (!ic && !webAdresiMi(url)) return;
  if (s.torBekliyor) { s.bekleyenAdres = url; return; } // Tor bağlanınca bu adres açılır
  zinciriKapat(s, 'sonraki'); // yeni bir gezinme, "ileri" geçmişini siler (Chrome'daki gibi)
  if (s.tur === 'ic' && ic) {
    s.icSayfa = ic;
    s.icSorgu = icSorgu(url);
    s.icZaman = icZaman(url);
    s.icMod = icMod(url);
    icYukle(s.view.webContents, ic, s);
    oturumuKaydet();
    return arayuzuGuncelle();
  }
  if ((s.tur === 'ic') !== Boolean(ic)) {
    // Umbra sayfası ile web sayfası ayrı görünümlerde çalışır: yeni görünüm aynı yere konur, eskisi kapatılmaz,
    // "geri" için arkada saklanır (sesi kısılır). Böylece geri/ileri iki sayfa arasında da çalışır.
    const konum = [...sekmeler.keys()].indexOf(s.id);
    const yeni = sekmeler.get(sekmeAc(url, s.tur === 'ic' ? 'normal' : s.tur, { konum, arkaPlanda: aktifId !== s.id }));
    sekmeyiSakla(s);
    yeni.onceki = s;
    s.sonraki = yeni;
    // Saklanan sayfa zinciri en fazla 4 adım geriye gider; daha eskileri kapatılır
    let x = yeni;
    for (let adim = 0; x.onceki; adim++, x = x.onceki) if (adim >= 3) { zinciriKapat(x, 'onceki'); break; }
    arayuzuGuncelle();
    return oturumuKaydet();
  }
  s.view.webContents.loadURL(url);
  s.view.webContents.focus();
}

// Görünür bir sekmeyi listeden ve ekrandan çıkarır ama kapatmaz (geri/ileri zincirinde saklanır)
function sekmeyiSakla(s) {
  if (aktifId === s.id) { pencere.contentView.removeChildView(s.view); aktifId = null; }
  sekmeler.delete(s.id);
  s.view.webContents.setAudioMuted(true);
}

// Görünür sekme s'nin yerine zincirdeki saklı sekme h'yi koyar
function yerineKoy(s, h) {
  const konum = [...sekmeler.keys()].indexOf(s.id);
  const aktifti = aktifId === s.id;
  sekmeyiSakla(s);
  sekmeler.set(h.id, h);
  sirayaKoy(h.id, konum);
  h.view.webContents.setAudioMuted(false);
  if (aktifti) sekmeyeGec(h.id);
  else arayuzuGuncelle();
  oturumuKaydet();
}

// Bir yöndeki (onceki/sonraki) saklı sekmelerin hepsini kapatır
function zinciriKapat(s, yon) {
  let x = s[yon];
  s[yon] = null;
  // Zincir hiçbir zaman ekranda görünen bir sekmeye ulaşıp onu kapatmamalı
  while (x && sekmeler.get(x.id) !== x) {
    const devam = x[yon];
    engellenen.delete(x.view.webContents.id);
    turbo.temizle(x.view.webContents.id);
    if (!x.view.webContents.isDestroyed()) x.view.webContents.close();
    x = devam;
  }
}

function geriGit(s) {
  if (!s) return;
  const g = s.view.webContents.navigationHistory;
  if (g.canGoBack()) { s.gecmisGezinme = true; g.goBack(); } else if (s.onceki) yerineKoy(s, s.onceki);
}

function ileriGit(s) {
  if (!s) return;
  const g = s.view.webContents.navigationHistory;
  if (g.canGoForward()) { s.gecmisGezinme = true; g.goForward(); } else if (s.sonraki) yerineKoy(s, s.sonraki);
}

function sagTikMenusu(wc, p, tur) {
  const ogeler = [];
  if (p.linkURL && webAdresiMi(p.linkURL)) {
    ogeler.push(
      { label: 'Bağlantıyı yeni sekmede aç', click: () => sekmeAc(p.linkURL, tur, { arkaPlanda: true }) },
      { label: 'Bağlantıyı gizli sekmede aç', click: () => sekmeAc(p.linkURL, 'gizli') },
      { label: 'Bağlantıyı Tor sekmesinde aç', click: () => sekmeAc(p.linkURL, 'tor') },
      { label: 'Bağlantı adresini kopyala', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image' && webAdresiMi(p.srcURL)) {
    ogeler.push(
      { label: 'Resmi farklı kaydet', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Resim adresini kopyala', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  if (p.isEditable) {
    ogeler.push({ role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { type: 'separator' });
  } else if (p.selectionText) {
    const metin = p.selectionText.trim().slice(0, 200);
    ogeler.push(
      { role: 'copy', label: 'Kopyala' },
      { label: `"${metin.slice(0, 30)}" için ara`, click: () => sekmeAc(veri.aramaAdresi(metin, tur), tur) },
      { label: '✨ AI ile açıkla', click: () => panelaSor(`Şu ifadeyi açıkla:\n"${p.selectionText.trim()}"`) },
      { label: '✨ AI ile Türkçeye çevir', click: () => panelaSor(`Şunu Türkçeye çevir:\n"${p.selectionText.trim()}"`) },
      { type: 'separator' },
    );
  }
  const turboOgeleri = turboMenuOgeleri([...sekmeler.values()].find((x) => x.view.webContents === wc), p);
  if (turboOgeleri.length) ogeler.push(...turboOgeleri, { type: 'separator' });
  ogeler.push(
    ...(() => {
      const s = [...sekmeler.values()].find((x) => x.view.webContents === wc);
      return [
        { label: 'Geri', enabled: wc.navigationHistory.canGoBack() || Boolean(s?.onceki), click: () => geriGit(s) },
        { label: 'İleri', enabled: wc.navigationHistory.canGoForward() || Boolean(s?.sonraki), click: () => ileriGit(s) },
      ];
    })(),
    { label: 'Yenile', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Sayfayı farklı kaydet', click: () => sayfayiKaydet(wc) },
    { label: 'Yazdır', click: () => wc.print() },
    { label: 'İncele', click: () => wc.inspectElement(p.x, p.y) },
  );
  Menu.buildFromTemplate(ogeler).popup();
}

async function sayfayiKaydet(wc) {
  if (!wc || !webAdresiMi(wc.getURL())) return;
  const ad = (wc.getTitle() || 'sayfa').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'sayfa';
  const { canceled, filePath } = await dialog.showSaveDialog(pencere, {
    defaultPath: benzersizYol(app.getPath('downloads'), ad + '.html'),
    filters: [{ name: 'Web sayfası (tamamı)', extensions: ['html'] }],
  });
  if (!canceled && filePath) await wc.savePage(filePath, 'HTMLComplete');
}

function sekmeyeGec(id) {
  const yeni = sekmeler.get(id);
  if (!yeni) return;
  const eski = aktifSekme();
  if (eski && eski !== yeni) {
    eski.view.webContents.stopFindInPage('clearSelection');
    pencere.contentView.removeChildView(eski.view);
  }
  pencere.contentView.addChildView(yeni.view);
  aktifId = id;
  arayuz.webContents.send('bul:kapat');
  yerlesim();
  yeni.view.webContents.focus();
  arayuzuGuncelle();
}

function sekmeKapat(id, { kayitsiz = false } = {}) {
  const s = sekmeler.get(id);
  if (!s) return;
  const sira = [...sekmeler.keys()];
  const i = sira.indexOf(id);
  if (!kayitsiz && s.tur === 'normal') {
    const adres = sekmeAdresi(s);
    if (webAdresiMi(adres)) kapatilanlar.push({ adres, konum: i });
    if (kapatilanlar.length > 25) kapatilanlar.shift();
  }
  if (aktifId === id) pencere.contentView.removeChildView(s.view);
  sekmeler.delete(id);
  zinciriKapat(s, 'onceki');
  zinciriKapat(s, 'sonraki');
  engellenen.delete(s.view.webContents.id);
  turbo.temizle(s.view.webContents.id);
  s.view.webContents.close();
  if (s.tur !== 'normal' && s.tur !== 'ic' && ![...sekmeler.values()].some((x) => x.tur === s.tur)) oturumuTemizle(s.tur);
  if (!sekmeler.size) return pencere.close();
  if (aktifId === id) {
    const kalan = [...sekmeler.keys()];
    sekmeyeGec(kalan[Math.min(i, kalan.length - 1)]);
  } else {
    arayuzuGuncelle();
  }
  oturumuKaydet();
}

function kapatilaniAc() {
  const son = kapatilanlar.pop();
  if (son) sekmeAc(son.adres, 'normal', { konum: Math.min(son.konum, sekmeler.size) });
}

function siradakiSekme(yon) {
  const sira = [...sekmeler.keys()];
  const i = sira.indexOf(aktifId);
  sekmeyeGec(sira[(i + yon + sira.length) % sira.length]);
}

// metin verilirse adres çubuğuna yazılır (yeni sekme sayfasındaki kutuya yazmaya başlayınca, Chrome'daki gibi)
function adresCubugunaOdaklan(metin = '') {
  arayuz.webContents.focus();
  arayuz.webContents.send('focus:address', String(metin).slice(0, 2000));
}

// Arama önerileri ve klasik arama sonuçları için ayrı, yalnızca bellekte tutulan oturum: arama siteleri,
// kullanıcının gezdiği sitelerdeki çerezleri göremez ve aramaları hesaba bağlayamaz.
let aramaOturumuNesnesi = null;
function aramaOturumu() {
  if (!aramaOturumuNesnesi) {
    aramaOturumuNesnesi = session.fromPartition('umbra-arama');
    sertlestir(aramaOturumuNesnesi, 'arama');
  }
  return aramaOturumuNesnesi;
}

// Adres çubuğu için arama önerileri (DuckDuckGo; hesap istemez, iz sürmez). Şifreli DNS ve izleyici engelleme
// bu isteklere de uygulanır. Tor sekmelerinde yazılanlar hiçbir yere gönderilmez.
const oneriOnbellegi = new Map();
async function aramaOnerileri(metin) {
  const q = String(metin || '').trim().slice(0, 200);
  const s = aktifSekme();
  if (!q || !veri.ayarlar.aramaOnerileri || !s || s.tur === 'tor' || webAdresiMi(q) || icSayfa(q)) return [];
  if (oneriOnbellegi.has(q)) return oneriOnbellegi.get(q);
  const ses = aramaOturumu();
  try {
    const yanit = await ses.fetch(`https://duckduckgo.com/ac/?type=list&kl=tr-tr&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(2000), headers: { Accept: 'application/json' },
    });
    const veriler = await yanit.json();
    const liste = (Array.isArray(veriler?.[1]) ? veriler[1] : [])
      .filter((x) => typeof x === 'string' && x.trim() && x.toLowerCase() !== q.toLowerCase()).slice(0, 5);
    oneriOnbellegi.set(q, liste);
    if (oneriOnbellegi.size > 200) oneriOnbellegi.delete(oneriOnbellegi.keys().next().value);
    return liste;
  } catch {
    return [];
  }
}

function bulAc() {
  arayuz.webContents.focus();
  arayuz.webContents.send('bul:ac');
}

function yerImleriDegisti() {
  arayuzuGuncelle();
  icSayfalaraBildir('yer-imleri');
}

function yerImiPenceresiGonder(y, yeni) {
  arayuz.webContents.focus();
  arayuz.webContents.send('yerimi:pencere', {
    id: y.id, baslik: y.baslik, url: y.url, klasor: veri.klasoru(y), yeni,
    klasorler: veri.klasorler().map((k) => ({ k, ad: klasorAdi(k) })),
  });
}

// Yıldız / Ctrl+D (Chrome gibi): sayfa yer imlerinde değilse hemen çubuğa eklenir, ardından ad ve klasörün
// seçildiği küçük pencere açılır. Zaten ekliyse aynı pencere düzenleme için açılır.
function yerImiPenceresi() {
  const s = aktifSekme();
  const url = s && sekmeAdresi(s);
  if (!webAdresiMi(url)) return;
  const yeni = !veri.yerImiMi(url);
  const y = veri.yerImiEkle(url, s.view.webContents.getTitle());
  yerImleriDegisti();
  yerImiPenceresiGonder(y, yeni);
}

function yerImiCubugunuDegistir(acik = !veri.ayarlar.yerImiCubugu) {
  veri.ayarla('yerImiCubugu', acik);
  yerlesim();
  arayuzuGuncelle();
}

// Yer işaretleri çubuğundaki bir öğenin sağ tık menüsü
function yerImiMenusu(id, x, y) {
  const b = veri.yerImleri.find((k) => k.id === id);
  if (!b) return;
  Menu.buildFromTemplate([
    { label: 'Aç', click: () => git(aktifSekme(), b.url) },
    { label: 'Yeni sekmede aç', click: () => sekmeAc(b.url, 'normal', { arkaPlanda: true }) },
    { label: 'Gizli sekmede aç', click: () => sekmeAc(b.url, 'gizli') },
    { type: 'separator' },
    { label: 'Düzenle…', click: () => yerImiPenceresiGonder(b, false) },
    { label: 'Sil', click: () => { veri.yerImiSil(b.id); yerImleriDegisti(); } },
    { type: 'separator' },
    { label: 'Yer işaretleri yöneticisi', click: () => sekmeAc('umbra://yer-imleri') },
    { label: 'Yer işaretleri çubuğunu gizle', click: () => yerImiCubugunuDegistir(false) },
  ]).popup({ window: pencere, x: Math.round(x), y: Math.round(y) });
}

// Çubuğa sığmayanlar (») ve "Tüm yer işaretleri" menüleri
const yerImiOgesi = (b) => ({ label: (b.baslik || b.url).slice(0, 60), click: () => git(aktifSekme(), b.url) });
function yerImiTasmaMenusu(idler, x, y) {
  const ogeler = idler.map((id) => veri.yerImleri.find((k) => k.id === id)).filter(Boolean).map(yerImiOgesi);
  if (ogeler.length) Menu.buildFromTemplate(ogeler).popup({ window: pencere, x: Math.round(x), y: Math.round(y) });
}
function tumYerImleriMenusu(x, y) {
  const ogeler = veri.klasorler().filter((k) => k !== 'cubuk').map((k) => {
    const icindekiler = veri.yerImleri.filter((b) => veri.klasoru(b) === k);
    return { label: `📁 ${klasorAdi(k)}`, submenu: icindekiler.length ? icindekiler.map(yerImiOgesi) : [{ label: '(boş)', enabled: false }] };
  });
  Menu.buildFromTemplate([
    ...ogeler,
    { type: 'separator' },
    { label: 'Yer işaretleri yöneticisi', accelerator: 'CmdOrCtrl+Shift+O', click: () => sekmeAc('umbra://yer-imleri') },
    { label: veri.ayarlar.yerImiCubugu ? 'Yer işaretleri çubuğunu gizle' : 'Yer işaretleri çubuğunu göster', accelerator: 'CmdOrCtrl+Shift+B', click: () => yerImiCubugunuDegistir() },
  ]).popup({ window: pencere, x: Math.round(x), y: Math.round(y) });
}

function zoom(fark) {
  const wc = aktifWc();
  if (wc) wc.setZoomLevel(fark === 0 ? 0 : wc.getZoomLevel() + fark);
}

function anaMenuOgeleri() {
  return [
    { label: 'Yeni sekme', accelerator: 'CmdOrCtrl+T', click: () => sekmeAc() },
    { label: 'Yeni gizli sekme', accelerator: 'CmdOrCtrl+Shift+N', click: () => sekmeAc(null, 'gizli') },
    // Alt+Shift, Windows'ta klavye dilini değiştirdiği için kullanılmaz
    { label: 'Yeni Tor sekmesi', accelerator: 'CmdOrCtrl+Shift+U', click: () => sekmeAc(null, 'tor') },
    { type: 'separator' },
    { label: 'Geçmiş', accelerator: 'CmdOrCtrl+H', click: () => sekmeAc('umbra://gecmis') },
    { label: 'İndirilenler', accelerator: 'CmdOrCtrl+J', click: () => sekmeAc('umbra://indirilenler') },
    { label: 'Yer imleri', accelerator: 'CmdOrCtrl+Shift+O', click: () => sekmeAc('umbra://yer-imleri') },
    { type: 'separator' },
    { label: 'Sayfada bul…', accelerator: 'CmdOrCtrl+F', click: bulAc },
    { label: 'Bu sayfayı yer imlerine ekle', accelerator: 'CmdOrCtrl+D', click: yerImiPenceresi },
    { label: 'Yer işaretleri çubuğunu göster/gizle', accelerator: 'CmdOrCtrl+Shift+B', click: () => yerImiCubugunuDegistir() },
    { label: 'Sayfayı farklı kaydet…', accelerator: 'CmdOrCtrl+S', click: () => sayfayiKaydet(aktifWc()) },
    { label: 'Yazdır…', accelerator: 'CmdOrCtrl+P', click: () => aktifWc()?.print() },
    { type: 'separator' },
    { label: 'Yakınlaştır', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
    { label: 'Uzaklaştır', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
    { label: 'Gerçek boyut', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
    { type: 'separator' },
    { label: '✨ Umbra AI', accelerator: 'Alt+A', click: () => panelAc() },
    { label: 'Ayarlar', click: () => sekmeAc('umbra://ayarlar') },
    { type: 'separator' },
    { label: 'Çık', click: () => pencere?.close() },
  ];
}

function menuyuKur() {
  // Görünmeyen uygulama menüsü yalnızca klavye kısayolları içindir
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Umbra',
      submenu: [
        ...anaMenuOgeleri(),
        { label: 'Kapatılan sekmeyi aç', accelerator: 'CmdOrCtrl+Shift+T', click: kapatilaniAc },
        { label: 'Sekmeyi kapat', accelerator: 'CmdOrCtrl+W', click: () => sekmeKapat(aktifId) },
        { label: 'Sonraki sekme', accelerator: 'Ctrl+Tab', click: () => siradakiSekme(1) },
        { label: 'Önceki sekme', accelerator: 'Ctrl+Shift+Tab', click: () => siradakiSekme(-1) },
        { label: 'Adres çubuğu', accelerator: 'CmdOrCtrl+L', click: adresCubugunaOdaklan },
        { label: 'Adres çubuğu ', accelerator: 'F6', click: adresCubugunaOdaklan },
        { label: 'Yenile', accelerator: 'F5', click: () => aktifWc()?.reload() },
        { label: 'Yenile ', accelerator: 'CmdOrCtrl+R', click: () => aktifWc()?.reload() },
        { label: 'Önbelleksiz yenile', accelerator: 'CmdOrCtrl+Shift+R', click: () => aktifWc()?.reloadIgnoringCache() },
        { label: 'Geri', accelerator: 'Alt+Left', click: () => geriGit(aktifSekme()) },
        { label: 'İleri', accelerator: 'Alt+Right', click: () => ileriGit(aktifSekme()) },
        { label: 'Yakınlaştır ', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.5) },
        { label: 'Geliştirici araçları', accelerator: 'F12', click: () => aktifWc()?.toggleDevTools() },
        { label: 'Tam ekran', accelerator: 'F11', click: () => pencere.setFullScreen(!pencere.isFullScreen()) },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
        { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü seç' },
      ],
    },
  ]));
}

// --- İç sayfalar (umbra://...) ---
function icSekmeleri() {
  return [...sekmeler.values()].filter((s) => s.tur === 'ic' && !s.view.webContents.isDestroyed());
}

function icSayfalaraBildir(sayfa) {
  const hedef = sayfa === 'guncelleme' ? 'ayarlar' : sayfa;
  for (const s of icSekmeleri()) if (s.icSayfa === hedef) s.view.webContents.send('ic:degisti', sayfa);
}

function icVerisi(sayfa, arama = '') {
  if (sayfa === 'gecmis') {
    const q = String(arama).toLowerCase();
    const sonuc = [];
    for (let i = veri.gecmis.length - 1; i >= 0 && sonuc.length < 1000; i--) {
      const g = veri.gecmis[i];
      if (!q || g.url.toLowerCase().includes(q) || (g.baslik || '').toLowerCase().includes(q)) sonuc.push(g);
    }
    return { gecmis: sonuc };
  }
  if (sayfa === 'yer-imleri') {
    return {
      yerImleri: [...veri.yerImleri].reverse().map((y) => ({ ...y, klasor: veri.klasoru(y) })),
      klasorler: veri.klasorler().map((k) => ({ k, ad: klasorAdi(k) })),
    };
  }
  if (sayfa === 'ara') {
    return {
      aiAnahtar: asistan.anahtarVar(),
      varsayilan: veri.ayarlar.aramaMotoru === 'umbra',
      kisayollar: veri.kisayollar(),
      yedekMotor: { ad: veri.ozelMotor().ad, ara: veri.ozelMotor().ara },
    };
  }
  if (sayfa === 'indirilenler') return { indirilenler: tumIndirmeler() };
  if (sayfa === 'ayarlar') {
    return {
      ayarlar: veri.ayarlar,
      motorlar: Object.fromEntries(Object.entries(ARAMA_MOTORLARI).map(([k, v]) => [k, v.ad])),
      ozelMotorlar: Object.fromEntries(OZEL_MOTORLAR.map((k) => [k, ARAMA_MOTORLARI[k].ad])),
      aiAnahtar: asistan.anahtarVar(),
      turboAcik: turbo.acik,
      guncelleme: guncelleyici.durum,
      guvenlikListesi: { kayit: guvenlik.boyut, zaman: guvenlik.zaman },
      surum: { umbra: app.getVersion(), chromium: process.versions.chrome, electron: process.versions.electron },
    };
  }
  return {};
}

async function veriTemizle(sec) {
  if (sec.gecmis) { veri.gecmisiSil('hepsi'); kapatilanlar.length = 0; }
  if (sec.cerez) await normalOturum.clearStorageData();
  if (sec.onbellek) await normalOturum.clearCache();
  if (sec.indirmeler) { veri.indirmeleriTemizle(); geciciIndirmeler.splice(0); }
  if (sec.izinler) izinKararlari.clear();
  indirmeDegisti();
}

async function icEylem(e, eylem, ...arg) {
  const s = [...sekmeler.values()].find((x) => x.tur === 'ic' && x.view.webContents === e.sender);
  switch (eylem) {
    case 'ac': {
      const url = adreseCevir(arg[0]);
      if (!url) return;
      if (arg[1]) sekmeAc(url, 'normal', { arkaPlanda: true });
      else git(s, url);
      return;
    }
    case 'gecmis-sil': veri.gecmisiSil(arg[0] === 'hepsi' ? 'hepsi' : [].concat(arg[0]).map(Number)); return;
    case 'yerimi-sil': veri.yerImiSil(Number(arg[0])); arayuzuGuncelle(); return;
    case 'yerimi-duzenle': {
      const tamam = veri.yerImiDuzenle(Number(arg[0]), arg[1], adreseCevir(arg[2]), typeof arg[3] === 'string' ? arg[3] : undefined);
      if (tamam) arayuzuGuncelle();
      return { tamam };
    }
    case 'kisayol-ekle': {
      const url = adreseCevir(arg[1]);
      return { tamam: Boolean(url && webAdresiMi(url) && veri.kisayolEkle(arg[0], url)) };
    }
    case 'kisayol-sil': veri.kisayolKaldir(String(arg[0] || '')); return {};
    case 'indirme': return indirmeEylemi(String(arg[0]), String(arg[1]));
    case 'indirmeleri-temizle': veri.indirmeleriTemizle(); geciciIndirmeler.splice(0); indirmeDegisti(); return;
    case 'ayar': {
      const tamam = veri.ayarla(String(arg[0]), arg[1]);
      // Video üstündeki "İndir" düğmesi açık sekmelerde de hemen gizlenir/görünür
      if (tamam && arg[0] === 'yerImiCubugu') { yerlesim(); arayuzuGuncelle(); }
      if (tamam && arg[0] === 'turboIndir') {
        for (const x of sekmeler.values()) if (x.tur === 'normal') x.view.webContents.send('turbo:etkin', turboDugmesiEtkin());
      }
      return { tamam };
    }
    case 'veri-temizle': return veriTemizle(arg[0] || {});
    case 'ai-ayar': return panelAc(true);
    case 'ara': {
      // Yanıt metni akarken sayfaya parça parça gönderilir; sayfa kapanırsa parçalar sessizce atılır
      const gonder = (parca) => { if (!e.sender.isDestroyed()) e.sender.send('ic:parca', parca); };
      const durum = (d) => { if (!e.sender.isDestroyed()) e.sender.send('ic:arama-durum', d); };
      return asistan.ara(String(arg[0] || ''), gonder, durum, ZAMANLAR.includes(arg[1]) ? arg[1] : '');
    }
    case 'ara-durdur': asistan.aramayiDurdur(); return;
    case 'ara-motor': return { tamam: veri.ayarla('aramaMotoru', 'umbra') };
    case 'adres-cubuguna': return adresCubugunaOdaklan(arg[0]);
    case 'web-ara': {
      const mod = ['tumu', 'gorsel', 'video', 'haber'].includes(arg[0]) ? arg[0] : 'tumu';
      const devam = arg[3] && typeof arg[3] === 'object' ? Object.fromEntries(Object.entries(arg[3]).map(([k, v]) => [String(k), String(v)])) : null;
      return webArama(aramaOturumu(), mod, String(arg[1] || ''), { zaman: ZAMANLAR.includes(arg[2]) ? arg[2] : '', devam });
    }
    case 'disa-aktar': {
      const tarih = new Date().toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog(pencere, {
        title: 'Umbra verilerini dışa aktar',
        defaultPath: path.join(app.getPath('documents'), `Umbra-Yedek-${tarih}.umbra`),
        filters: [{ name: 'Umbra yedeği', extensions: ['umbra'] }],
      });
      if (canceled || !filePath) return { iptal: true };
      const yedek = veri.disaAktar(arg[0] || {});
      fs.writeFileSync(filePath, JSON.stringify(yedek));
      return { dosya: path.basename(filePath), yerImleri: yedek.yerImleri?.length || 0, gecmis: yedek.gecmis?.length || 0 };
    }
    case 'ice-aktar': {
      const { canceled, filePaths } = await dialog.showOpenDialog(pencere, {
        title: 'Umbra yedeğini içe aktar',
        properties: ['openFile'],
        filters: [{ name: 'Umbra yedeği', extensions: ['umbra', 'json'] }],
      });
      if (canceled || !filePaths?.length) return { iptal: true };
      if (fs.statSync(filePaths[0]).size > 100 * 1024 * 1024) return { hata: 'Dosya çok büyük.' };
      let yedek;
      try { yedek = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch { return { hata: 'Dosya okunamadı ya da bozuk.' }; }
      const sayi = veri.iceAktar(yedek);
      arayuzuGuncelle();
      for (const s of ['gecmis', 'yer-imleri']) icSayfalaraBildir(s);
      return sayi;
    }
    case 'indirme-klasoru': return shell.openPath(app.getPath('downloads'));
    case 'guncelleme-denetle': guncelleyici.denetle(); return;
    case 'guncelleme-yeniden': guncelleyici.yenidenBaslat(); return;
    case 'turbo-goster': return turbo.goster().then(() => ({}), () => ({ hata: 'TurboDownloader açık değil.' }));
    default: return { hata: 'bilinmeyen eylem' };
  }
}

function ipcKur() {
  const uiMi = (e) => arayuz && e.sender === arayuz.webContents;
  const dinle = (kanal, fn) => ipcMain.on(kanal, (e, ...arg) => { if (uiMi(e)) fn(...arg); });
  dinle('tab:new', (tur) => sekmeAc(null, TURLER.includes(tur) ? tur : 'normal'));
  dinle('tab:close', (id) => sekmeKapat(Number(id)));
  dinle('tab:switch', (id) => sekmeyeGec(Number(id)));
  dinle('nav:go', (girdi) => git(aktifSekme(), adreseCevir(girdi, aktifSekme()?.tur)));
  dinle('nav:back', () => geriGit(aktifSekme()));
  dinle('nav:forward', () => ileriGit(aktifSekme()));
  dinle('nav:reload', () => aktifWc()?.reload());
  dinle('nav:stop', () => aktifWc()?.stop());
  dinle('nav:home', () => git(aktifSekme(), veri.anaSayfa(aktifSekme()?.tur)));
  dinle('ai:panel', () => panelAc());
  dinle('yerimi:pencere', yerImiPenceresi);
  dinle('yerimi:kaydet', (id, baslik, klasor) => {
    const b = veri.yerImleri.find((k) => k.id === Number(id));
    if (b && veri.yerImiDuzenle(b.id, String(baslik || ''), b.url, String(klasor || 'cubuk'))) yerImleriDegisti();
  });
  dinle('yerimi:kaldir', (id) => { veri.yerImiSil(Number(id)); yerImleriDegisti(); });
  dinle('yerimi:ac', (id, yeniSekme) => {
    const b = veri.yerImleri.find((k) => k.id === Number(id));
    if (!b) return;
    if (yeniSekme) sekmeAc(b.url, 'normal', { arkaPlanda: true });
    else git(aktifSekme(), b.url);
  });
  dinle('yerimi:menu', (id, x, y) => yerImiMenusu(Number(id), x, y));
  dinle('yerimi:tasma', (idler, x, y) => yerImiTasmaMenusu([].concat(idler).map(Number), x, y));
  dinle('yerimi:tumu', (x, y) => tumYerImleriMenusu(x, y));
  dinle('indirilenler:ac', () => sekmeAc('umbra://indirilenler'));
  dinle('medya:menu', medyaMenusu);
  dinle('guncelleme:yeniden', () => guncelleyici.yenidenBaslat());
  dinle('ui:menu', (x, y) => Menu.buildFromTemplate(anaMenuOgeleri()).popup({ window: pencere, x: Math.round(x), y: Math.round(y) }));
  dinle('ui:yukseklik', (ek) => {
    arayuzEk = Math.max(0, Math.min(420, Number(ek) || 0));
    yerlesim();
  });
  dinle('bul:ara', (metin, ileri, yeni) => {
    const wc = aktifWc();
    if (!wc) return;
    if (!metin) { wc.stopFindInPage('clearSelection'); arayuz.webContents.send('bul:sonuc', { aktif: 0, toplam: 0 }); return; }
    wc.findInPage(String(metin), { forward: ileri !== false, findNext: yeni === true });
  });
  dinle('bul:kapat', () => {
    const wc = aktifWc();
    if (wc) { wc.stopFindInPage('clearSelection'); wc.focus(); }
  });
  ipcMain.handle('oneri:al', (e, metin) => (uiMi(e) ? veri.oneriler(String(metin)) : []));
  ipcMain.handle('oneri:arama', (e, metin) => (uiMi(e) ? aramaOnerileri(metin) : []));

  // Video üstü "İndir ▼" düğmesi kanalları: yalnızca normal sekmelerin ana çerçevesindeki Umbra kodu çağırabilir.
  // Sayfa adresi gönderenden değil, sekmenin kendisinden alınır; diğer alanlar tek tek doğrulanır.
  const normalSekme = (e) => {
    const s = [...sekmeler.values()].find((x) => x.tur === 'normal' && x.view.webContents === e.sender);
    return s && e.senderFrame === e.sender.mainFrame ? s : null;
  };
  const adresVeyaBos = (u) => (typeof u === 'string' && webAdresiMi(u) && u.length <= 4096 ? u : '');
  const kullanilamaz = { error: 'TurboDownloader kullanılamıyor' };
  ipcMain.handle('turbo:durum', (e) => ({ etkin: Boolean(normalSekme(e)) && turboDugmesiEtkin() }));
  ipcMain.handle('turbo:formatlar', (e, a = {}) => {
    const s = normalSekme(e);
    if (!s || !turboDugmesiEtkin()) return kullanilamaz;
    const wc = s.view.webContents;
    return turbo.formatlar(wc.session, wc.id, wc.getURL(), adresVeyaBos(a.src));
  });
  ipcMain.handle('turbo:indir', async (e, a = {}) => {
    const s = normalSekme(e);
    if (!s || !turboDugmesiEtkin()) return kullanilamaz;
    try {
      await turboSayfaGonder(s, {
        mode: a.mode === 'audio' ? 'audio' : 'video',
        quality: Math.max(0, Math.min(100000, Number(a.quality) || 0)),
        source: adresVeyaBos(a.source),
        src: adresVeyaBos(a.src),
      });
      return {};
    } catch (h) {
      return { error: h.message };
    }
  });
  ipcMain.handle('turbo:dogrudan', async (e, a = {}) => {
    const s = normalSekme(e);
    const src = adresVeyaBos(a.src);
    if (!s || !turboDugmesiEtkin() || !src) return kullanilamaz;
    try {
      await turbo.gonder(s.view.webContents.session, { url: src, referer: s.view.webContents.getURL(), mediaHint: true });
      turboKaydi(src.split('/').pop() || src, src);
      return {};
    } catch (h) {
      return { error: h.message };
    }
  });

  // AI paneli kanalları: yalnızca panel sayfası çağırabilir
  const panelMi = (e) => panel && e.sender === panel.webContents;
  const panelDinle = (kanal, fn) => ipcMain.on(kanal, (e, ...arg) => { if (panelMi(e)) fn(...arg); });
  const panelCevapla = (kanal, fn) => ipcMain.handle(kanal, async (e, ...arg) => {
    if (!panelMi(e)) return { hata: 'yetkisiz' };
    try { return (await fn(...arg)) || {}; } catch (h) { return { hata: h.message }; }
  });
  panelDinle('ai:panel', () => panelAc(false));
  panelDinle('ai:durdur', () => asistan.durdur());
  panelDinle('ai:sifirla', () => asistan.sifirla());
  panelDinle('ai:konsol', () => sekmeAc('https://console.anthropic.com/settings/keys'));
  panelCevapla('ai:durum', () => ({ anahtarVar: asistan.anahtarVar() }));
  panelCevapla('ai:anahtar', (anahtar) => asistan.anahtarKaydet(anahtar));
  panelCevapla('ai:anahtar-sil', () => asistan.anahtarSil());
  panelCevapla('ai:sor', async (soru, sayfaDahil) => {
    const s = aktifSekme();
    // Tor sekmesinin içeriği anonimliği korumak için asla dışarı gönderilmez
    const sayfa = sayfaDahil && s && s.tur !== 'tor' && !s.torBekliyor && webAdresiMi(s.view.webContents.getURL())
      ? await sayfaMetni(s)
      : null;
    return asistan.sor(soru, sayfa, (parca) => {
      if (panel && !panel.webContents.isDestroyed()) panel.webContents.send('ai:parca', parca);
    });
  });

  // İç sayfa kanalları: yalnızca umbra:// sekmeleri çağırabilir
  const icMi = (e) => icSekmeleri().some((s) => s.view.webContents === e.sender);
  ipcMain.handle('ic:veri', (e, sayfa, arama) => (icMi(e) ? icVerisi(String(sayfa), arama) : {}));
  ipcMain.handle('ic:eylem', async (e, eylem, ...arg) => {
    if (!icMi(e)) return { hata: 'yetkisiz' };
    try { return (await icEylem(e, String(eylem), ...arg)) || {}; } catch (h) { return { hata: h.message }; }
  });
}

// Her web içeriği için genel kurallar: webview yok, http(s) dışına gezinme yok,
// Umbra'nın kendi sayfaları (arayüz, panel, iç sayfalar) hiçbir yere gidemez
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('will-navigate', (e, url) => {
    // Umbra'nın kendi sayfaları (arayüz, AI paneli, umbra:// sayfaları) varsayılan oturumda çalışır ve hiçbir yere gidemez.
    // Gizli/Tor başlangıç sayfası ise kendi oturumundadır ve arama sonucuna gidebilir.
    const yerel = wc.getURL().startsWith('file:') && wc.session === session.defaultSession;
    if (yerel || !webAdresiMi(url)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!webAdresiMi(url)) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Geçersiz sertifikalar asla kabul edilmez
app.on('certificate-error', (e, _wc, _url, _hata, _sertifika, cb) => {
  e.preventDefault();
  cb(false);
});

app.on('second-instance', () => {
  if (!pencere) return;
  if (pencere.isMinimized()) pencere.restore();
  pencere.focus();
});

app.whenReady().then(() => {
  app.userAgentFallback = temizUserAgent(app.userAgentFallback);
  // DNS sorguları şifreli (DNS over HTTPS): internet sağlayıcısı hangi siteye girdiğinizi göremez
  app.configureHostResolver({
    secureDnsMode: 'secure',
    secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query'],
  });

  veri = new Veri(app.getPath('userData'));
  // Liste, çerezsiz ayrı bir oturumla indirilir; ziyaret edilen adresler hiçbir yere gönderilmez
  guvenlik = new GuvenlikListesi(app.getPath('userData'), session.fromPartition('umbra-guvenlik'));
  if (!DUMAN_TESTI && !ARAYUZ_TESTI) {
    setTimeout(() => guvenlik.guncelle().catch(() => {}), 15000);
    setInterval(() => guvenlik.guncelle().catch(() => {}), 3 * 60 * 60 * 1000).unref?.();
  }
  turbo = new TurboIndir();
  turbo.degisince = () => {
    arayuzuGuncelle();
    for (const x of sekmeler.values()) if (x.tur === 'normal') x.view.webContents.send('turbo:etkin', turboDugmesiEtkin());
  };
  sertlestir(session.defaultSession, 'arayuz');
  normalOturum = session.fromPartition('persist:umbra');
  sertlestir(normalOturum, 'normal');

  asistan = new Asistan(app.getPath('userData'));
  veri.aiVarMi = () => asistan.anahtarVar(); // anahtar yoksa Umbra Arama yerine özel motor kullanılır
  tor = new Tor(TOR_KOK, path.join(app.getPath('userData'), 'tor'));
  tor.on('durum', (d) => { torDurum = d; arayuzuGuncelle(); });

  pencere = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 360,
    title: 'Umbra',
    icon: SIMGE,
    backgroundColor: '#1f2228',
    // Chrome gibi: başlık çubuğu yok, sekmeler en üstte; küçült/büyüt/kapat düğmeleri sekme satırının sağında
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1f2228', symbolColor: '#e6e8ec', height: 38 },
  });
  // Uygulama menüsü yalnızca klavye kısayolları içindir; Alt'a basınca da görünmez
  pencere.setMenuBarVisibility(false);
  arayuz = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'arayuz', 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  arayuz.setBackgroundColor('#00000000');
  pencere.contentView.addChildView(arayuz);
  arayuz.webContents.loadFile(path.join(__dirname, 'arayuz', 'index.html'));
  arayuz.webContents.once('did-finish-load', arayuzuGuncelle);
  if (DUMAN_TESTI) {
    arayuz.webContents.once('did-finish-load', async () => {
      const ic = sekmeAc('umbra://ayarlar');
      const wc = sekmeler.get(ic).view.webContents;
      wc.once('did-finish-load', async () => {
        const metin = await wc.executeJavaScript('document.body.innerText');
        const tamam = metin.includes('Ayarlar') && fs.existsSync(path.join(TOR_KOK, 'tor', 'tor.exe'));
        console.log(tamam ? 'DUMAN TESTİ GEÇTİ' : 'DUMAN TESTİ BAŞARISIZ');
        app.exit(tamam ? 0 : 1);
      });
    });
  }

  pencere.on('resize', yerlesim);
  pencere.on('leave-full-screen', () => { tamEkran = false; yerlesim(); });
  pencere.on('close', () => {
    oturumuKaydet();
    kapaniyor = true;
    veri.hepsiniKaydet();
  });
  pencere.on('closed', () => {
    pencere = null;
    oturumuTemizle('gizli');
    oturumuTemizle('tor');
    tor.durdur();
    app.quit();
  });

  menuyuKur();
  ipcKur();
  guncelleyici.on('degisti', () => { arayuzuGuncelle(); icSayfalaraBildir('guncelleme'); });
  guncelleyici.baslat();
  if (ARAYUZ_TESTI) {
    arayuz.webContents.once('did-finish-load', () => setTimeout(() => require('./test/arayuz-testi')({
      get arayuz() { return arayuz; },
      get panel() { return panel; },
      get panelAcik() { return panelAcik; },
      get pencere() { return pencere; },
      get guvenlik() { return guvenlik; },
      sekmeler, aktifSekme, veri, sekmeAc, sekmeAdresi, tumIndirmeler, anaMenuOgeleri,
    }), 1500));
  }
  const onceki = veri.ayarlar.acilis === 'devam' ? veri.oturum.filter((u) => webAdresiMi(u) || icSayfa(u)) : [];
  if (onceki.length) {
    onceki.forEach((u, i) => sekmeAc(u, 'normal', { arkaPlanda: i > 0 }));
  } else {
    sekmeAc();
  }
});
