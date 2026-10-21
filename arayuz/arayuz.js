const $ = (id) => document.getElementById(id);
const liste = $('sekme-listesi');
const adres = $('adres');
const oneriKutusu = $('oneriler');
const TUR_SIMGESI = { gizli: '🕶', tor: '🧅', ic: '🌑' };
const ONERI_YUKSEKLIK = 38;
let adresDuzenleniyor = false;
let aktif = null;
let oneriler = [], seciliOneri = -1, oneriIstek = 0;

$('yeni-sekme').onclick = () => umbra.yeniSekme('normal');
$('yeni-gizli').onclick = () => umbra.yeniSekme('gizli');
$('yeni-tor').onclick = () => umbra.yeniSekme('tor');
$('geri').onclick = () => umbra.geri();
$('ileri').onclick = () => umbra.ileri();
$('ana').onclick = () => umbra.anaSayfa();
$('ai').onclick = () => umbra.aiPaneli();
$('yildiz').onclick = () => umbra.yerImi();
$('indirme').onclick = () => umbra.indirilenler();
$('guncelle').onclick = () => umbra.guncelle();
$('medya').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  umbra.medyaMenusu(r.left, r.bottom + 2);
};
$('menu').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  umbra.menu(r.right - 220, r.bottom + 2);
};

// --- Adres çubuğu ve öneriler ---
function adresiGeriYukle() {
  adresDuzenleniyor = false;
  if (aktif) adres.value = aktif.url;
}

function onerileriGizle() {
  if (oneriKutusu.hidden) return;
  oneriKutusu.hidden = true;
  oneriler = [];
  seciliOneri = -1;
  umbra.yukseklik(0);
}

function onerileriGoster() {
  if (!oneriler.length) return onerileriGizle();
  const f = $('adres-formu').getBoundingClientRect();
  oneriKutusu.style.left = f.left + 'px';
  oneriKutusu.style.width = f.width + 'px';
  oneriKutusu.replaceChildren(...oneriler.map((o, i) => {
    const el = document.createElement('div');
    el.className = 'oneri' + (i === seciliOneri ? ' secili' : '');
    const tur = document.createElement('span');
    tur.className = 'tur';
    tur.textContent = { yerimi: '☆', ara: '🔍', site: '🌐' }[o.tur] || '🕘';
    const metin = document.createElement('span');
    metin.className = 'metin';
    metin.textContent = o.baslik || o.url;
    if (o.tur !== 'ara') {
      const kucuk = document.createElement('small');
      kucuk.textContent = o.url;
      metin.append(kucuk);
    }
    el.append(tur, metin);
    // mousedown: odak kaybolup liste kapanmadan önce seçim yapılır
    el.onmousedown = (e) => { e.preventDefault(); oneriSec(i); };
    return el;
  }));
  oneriKutusu.hidden = false;
  umbra.yukseklik(oneriler.length * ONERI_YUKSEKLIK + 12);
}

function oneriSec(i) {
  const o = oneriler[i];
  if (!o) return;
  onerileriGizle();
  adresDuzenleniyor = false;
  umbra.git(o.tur === 'ara' ? '?' + o.baslik : o.url); // "?" öneki: site tahmini yapılmadan aranır
  adres.blur();
}

async function onerileriGetir() {
  const metin = adres.value;
  const istek = ++oneriIstek;
  if (!metin.trim()) return onerileriGizle();
  const bulunan = await umbra.oneriler(metin);
  if (istek !== oneriIstek || document.activeElement !== adres) return;
  // Tahmin edilen site (ör. "youtube" → youtube.com) en üstte; Enter'ın gideceği yer de odur
  const site = bulunan.filter((o) => o.tur === 'site');
  oneriler = [...site, { tur: 'ara', baslik: metin.trim().replace(/^\?/, ''), url: '' }, ...bulunan.filter((o) => o.tur !== 'site')];
  seciliOneri = -1;
  onerileriGoster();
}

$('adres-formu').onsubmit = (e) => {
  e.preventDefault();
  if (seciliOneri >= 0) return oneriSec(seciliOneri);
  onerileriGizle();
  adresDuzenleniyor = false;
  umbra.git(adres.value);
  adres.blur();
};
adres.addEventListener('focus', () => { adresDuzenleniyor = true; adres.select(); });
// Chrome'daki gibi: adres çubuğuna ilk tıklama tüm adresi seçer. Odaklanınca yapılan seçimi, hemen ardından
// gelen mouseup bozup imleci tıklanan yere koyar; bu yüzden ilk tıklamanın mouseup'ı engellenir.
let ilkTiklama = false;
adres.addEventListener('mousedown', () => { ilkTiklama = document.activeElement !== adres; });
adres.addEventListener('mouseup', (e) => {
  if (!ilkTiklama) return;
  ilkTiklama = false;
  if (adres.selectionStart === adres.selectionEnd) { e.preventDefault(); adres.select(); }
});
adres.addEventListener('blur', () => { adresDuzenleniyor = false; onerileriGizle(); });
adres.addEventListener('input', () => { adresDuzenleniyor = true; onerileriGetir(); });
adres.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!oneriKutusu.hidden) onerileriGizle();
    else { adresiGeriYukle(); adres.blur(); }
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && oneriler.length) {
    e.preventDefault();
    const n = oneriler.length;
    seciliOneri = e.key === 'ArrowDown' ? (seciliOneri + 1) % n : (seciliOneri - 1 + n) % n;
    const o = oneriler[seciliOneri];
    adres.value = o.tur === 'ara' ? o.baslik : o.url;
    onerileriGoster();
  }
});
umbra.odakDinle(() => { adres.focus(); adres.select(); });

// --- Sayfada bul ---
const bul = $('bul');
const bulMetin = $('bul-metin');
let bulSon = '';
function bulAc() {
  bul.hidden = false;
  bulMetin.focus();
  bulMetin.select();
  if (bulMetin.value) umbra.bulAra(bulMetin.value, true, true);
}
function bulKapat(sayfayaBildir = true) {
  if (bul.hidden) return;
  bul.hidden = true;
  $('bul-sonuc').textContent = '';
  bul.classList.remove('yok');
  bulSon = '';
  if (sayfayaBildir) umbra.bulKapat();
}
bulMetin.addEventListener('input', () => {
  bulSon = bulMetin.value;
  umbra.bulAra(bulMetin.value, true, true);
});
bul.onsubmit = (e) => { e.preventDefault(); };
bulMetin.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') bulKapat();
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (bulMetin.value !== bulSon) { bulSon = bulMetin.value; umbra.bulAra(bulMetin.value, true, true); }
    else umbra.bulAra(bulMetin.value, !e.shiftKey, false);
  }
});
$('bul-sonraki').onclick = () => umbra.bulAra(bulMetin.value, true, false);
$('bul-onceki').onclick = () => umbra.bulAra(bulMetin.value, false, false);
$('bul-kapat').onclick = () => bulKapat();
umbra.bulAcDinle(bulAc);
umbra.bulKapatDinle(() => bulKapat(false));
umbra.bulSonucDinle(({ aktif: a, toplam }) => {
  $('bul-sonuc').textContent = bulMetin.value ? `${a}/${toplam}` : '';
  bul.classList.toggle('yok', Boolean(bulMetin.value) && toplam === 0);
});

// --- Sekmeler ---
// Sekme öğeleri her güncellemede yeniden yaratılmaz, yerinde güncellenir: aksi halde bir tıklamanın basma ve
// bırakma anları arasında düğme yenisiyle değişir ve tıklama (ör. × ile kapatma) kaybolur.
const sekmeOgeleri = new Map(); // sekme id -> { el, simgeKutusu, baslik, simgeAnahtari }

function sekmeOgesiOlustur(id) {
  const el = document.createElement('div');
  const simgeKutusu = document.createElement('span');
  simgeKutusu.className = 'simge-kutusu';
  const baslik = document.createElement('span');
  baslik.className = 'baslik';
  const kapat = document.createElement('button');
  kapat.className = 'kapat';
  kapat.textContent = '×';
  kapat.title = 'Sekmeyi kapat (Ctrl+W)';
  // × sekmeyi önce etkinleştirmez (Chrome'daki gibi); kapatma tıklamanın sonunda olur
  kapat.onmousedown = (e) => e.stopPropagation();
  kapat.onclick = (e) => { e.stopPropagation(); umbra.sekmeKapat(id); };
  el.append(simgeKutusu, baslik, kapat);
  el.onmousedown = (e) => {
    if (e.button === 1) { e.preventDefault(); umbra.sekmeKapat(id); }
    else if (e.button === 0) umbra.sekmeyeGec(id);
  };
  return { el, simgeKutusu, baslik, simgeAnahtari: null };
}

function sekmeOgesiGuncelle(o, s) {
  o.el.className = 'sekme' + (s.aktif ? ' aktif' : '') + (s.tur !== 'normal' ? ' ' + s.tur : '');
  if (o.el.title !== s.baslik) o.el.title = s.baslik;
  if (o.baslik.textContent !== s.baslik) o.baslik.textContent = s.baslik;
  // Simge yalnızca gerçekten değiştiğinde yenilenir (titreme olmaz)
  const donuyor = s.yukleniyor && s.tur !== 'ic';
  const anahtar = donuyor ? 'donen' : s.favicon ? 'img:' + s.favicon : 'yer:' + s.tur;
  if (anahtar === o.simgeAnahtari) return;
  o.simgeAnahtari = anahtar;
  let simge;
  if (donuyor) {
    simge = Object.assign(document.createElement('span'), { className: 'donen' });
  } else if (s.favicon) {
    simge = document.createElement('img');
    simge.src = s.favicon;
    simge.onerror = () => simge.replaceWith(Object.assign(document.createElement('span'), { className: 'yer', textContent: TUR_SIMGESI[s.tur] || '' }));
  } else {
    simge = Object.assign(document.createElement('span'), { className: 'yer', textContent: TUR_SIMGESI[s.tur] || '' });
  }
  o.simgeKutusu.replaceChildren(simge);
}

function sekmeleriCiz(sekmeler) {
  const gorulen = new Set();
  const sirali = sekmeler.map((s) => {
    gorulen.add(s.id);
    let o = sekmeOgeleri.get(s.id);
    if (!o) { o = sekmeOgesiOlustur(s.id); sekmeOgeleri.set(s.id, o); }
    sekmeOgesiGuncelle(o, s);
    return o.el;
  });
  for (const [id, o] of sekmeOgeleri) if (!gorulen.has(id)) { o.el.remove(); sekmeOgeleri.delete(id); }
  // Sıra yalnızca gerçekten değiştiyse düzenlenir
  const mevcut = [...liste.children];
  if (mevcut.length !== sirali.length || sirali.some((el, i) => mevcut[i] !== el)) liste.replaceChildren(...sirali);
}

umbra.guncellemeyiDinle(({ sekmeler, aiAcik, indirme, guncelleme }) => {
  sekmeleriCiz(sekmeler);
  $('ai').classList.toggle('acik', aiAcik);
  $('guncelle').hidden = guncelleme.durum !== 'hazir';
  if (guncelleme.surum) $('guncelle').title = `Umbra ${guncelleme.surum} indirildi — yeniden başlatıp güncelle`;

  const ind = $('indirme');
  const oncekiAktif = ind.classList.contains('aktif');
  ind.hidden = !indirme.var;
  ind.classList.toggle('aktif', indirme.aktif > 0);
  if (indirme.aktif > 0 && !oncekiAktif) { ind.classList.remove('titre'); void ind.offsetWidth; ind.classList.add('titre'); }
  $('indirme-cubuk').style.transform = indirme.aktif > 0 ? `scaleX(${(indirme.yuzde ?? 50) / 100})` : 'scaleX(0)';
  ind.title = indirme.aktif > 0
    ? `${indirme.aktif} dosya iniyor${indirme.yuzde !== null ? ` (%${indirme.yuzde})` : ''}`
    : 'İndirilenler (Ctrl+J)';

  const a = sekmeler.find((s) => s.aktif);
  aktif = a;
  if (!a) return;

  document.body.classList.toggle('gizli-mod', a.tur === 'gizli');
  document.body.classList.toggle('tor-mod', a.tur === 'tor');
  adres.placeholder = a.tur === 'tor' ? 'Tor ile ara veya adres yaz (.onion da olur)' : 'Ara veya adres yaz';
  $('geri').disabled = !a.geri;
  $('ileri').disabled = !a.ileri;

  const yenile = $('yenile');
  yenile.textContent = a.yukleniyor ? '✕' : '↻';
  yenile.title = a.yukleniyor ? 'Durdur' : 'Yenile (F5)';
  yenile.onclick = () => (a.yukleniyor ? umbra.durdur() : umbra.yenile());

  const kilit = $('kilit');
  const web = /^https?:/.test(a.url);
  kilit.textContent = a.tur === 'ic' ? '🌑' : !web ? '' : a.guvenli ? '🔒' : '⚠';
  kilit.className = a.tur === 'ic' ? '' : !web ? '' : a.guvenli ? 'guvenli' : 'guvensiz';
  kilit.title = a.tur === 'ic' ? 'Umbra sayfası' : !web ? '' : a.guvenli ? 'Bağlantı şifreli (HTTPS)'
    : a.hatada ? 'Sayfa güvenlik nedeniyle engellendi' : 'Bağlantı şifresiz — bilgi girmeyin';

  const yildiz = $('yildiz');
  yildiz.hidden = !web;
  yildiz.textContent = a.yerImi ? '★' : '☆';
  yildiz.classList.toggle('dolu', a.yerImi);
  yildiz.title = a.yerImi ? 'Yer iminden kaldır (Ctrl+D)' : 'Yer imlerine ekle (Ctrl+D)';

  $('sayac').textContent = a.engellenen;
  const medya = $('medya');
  medya.hidden = a.medya < 0 || !web;
  $('medya-sayi').textContent = a.medya > 0 ? a.medya : '';
  medya.title = a.medya > 0 ? `TurboDownloader: sayfada ${a.medya} medya bulundu` : 'TurboDownloader ile bu sayfanın videosunu/sesini indir';
  if (!adresDuzenleniyor) adres.value = a.url === 'about:blank' ? '' : a.url;
  document.title = a.baslik + ' — Umbra';
});
