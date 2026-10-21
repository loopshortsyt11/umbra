const icerik = document.getElementById('icerik');
const BASLIKLAR = { ara: 'Yeni sekme', gecmis: 'Geçmiş', 'yer-imleri': 'Yer imleri', indirilenler: 'İndirilenler', ayarlar: 'Ayarlar' };
let sayfa = 'gecmis';

for (const a of document.querySelectorAll('nav a')) {
  a.onclick = (e) => { e.preventDefault(); ic.eylem('ac', 'umbra://' + a.dataset.sayfa); };
}

// Küçük yardımcı: el('div.sinif', {ozellik}, ...cocuklar). Metinler her zaman textContent ile eklenir.
function el(etiket, ozellik = {}, ...cocuklar) {
  const [ad, ...siniflar] = etiket.split('.');
  const d = document.createElement(ad);
  if (siniflar.length) d.className = siniflar.join(' ');
  for (const [k, v] of Object.entries(ozellik)) {
    if (k.startsWith('on')) d[k] = v;
    else if (k in d) d[k] = v;
    else d.setAttribute(k, v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c instanceof Node ? c : String(c));
  return d;
}

function host(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function boyut(b) {
  if (!b) return '';
  const birim = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < birim.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i > 1 ? 1 : 0)} ${birim[i]}`;
}

function gunEtiketi(zaman) {
  const g = new Date(zaman);
  const bugun = new Date();
  const dun = new Date(); dun.setDate(dun.getDate() - 1);
  const ayni = (a, b) => a.toDateString() === b.toDateString();
  if (ayni(g, bugun)) return 'Bugün';
  if (ayni(g, dun)) return 'Dün';
  return g.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function baglanti(url, metin) {
  return el('a.bag', {
    href: '#',
    title: url,
    onclick: (e) => { e.preventDefault(); ic.eylem('ac', url, e.ctrlKey); },
    onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); ic.eylem('ac', url, true); } },
  }, metin || url);
}

// --- Geçmiş ---
let aramaMetni = '';
async function gecmisCiz() {
  const { gecmis } = await ic.veri('gecmis', aramaMetni);
  const arama = el('input', { type: 'search', placeholder: 'Geçmişte ara', value: aramaMetni });
  arama.oninput = () => { aramaMetni = arama.value; clearTimeout(arama.z); arama.z = setTimeout(async () => { await gecmisCiz(); }, 200); };
  const bolumler = [];
  let gun = null, kart = null;
  for (const g of gecmis) {
    const etiket = gunEtiketi(g.zaman);
    if (etiket !== gun) {
      gun = etiket;
      kart = el('div.kart');
      bolumler.push(el('h2', {}, etiket), kart);
    }
    const saat = new Date(g.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    kart.append(el('div.satir', {},
      el('span.saat', {}, saat),
      el('div.govde', {}, el('div.ust', {}, baglanti(g.url, g.baslik || g.url)), el('div.alt', {}, host(g.url))),
      el('button.ikon', { title: 'Geçmişten kaldır', onclick: async () => { await ic.eylem('gecmis-sil', g.zaman); gecmisCiz(); } }, '×'),
    ));
  }
  const temizle = el('button.tehlike', {
    onclick: async () => {
      if (temizle.dataset.onay) { await ic.eylem('gecmis-sil', 'hepsi'); return gecmisCiz(); }
      temizle.dataset.onay = '1';
      temizle.textContent = 'Emin misin? Tekrar tıkla';
    },
  }, 'Tüm geçmişi temizle');
  icerik.replaceChildren(el('div.kap', {},
    el('h1', {}, 'Geçmiş', el('span.bosluk'), temizle),
    arama,
    bolumler.length ? bolumler : el('p.bos', {}, aramaMetni ? 'Eşleşen sayfa yok.' : 'Geçmiş boş. Gizli ve Tor sekmelerinde geçmiş hiç tutulmaz.'),
  ));
  const yeni = icerik.querySelector('input[type=search]');
  if (aramaMetni) { yeni.focus(); yeni.setSelectionRange(yeni.value.length, yeni.value.length); }
}

// --- Yer imleri ---
async function yerImleriCiz() {
  const { yerImleri } = await ic.veri('yer-imleri');
  const kart = el('div.kart');
  for (const y of yerImleri) {
    const satir = el('div.satir');
    const normal = () => satir.replaceChildren(
      el('div.govde', {}, el('div.ust', {}, baglanti(y.url, y.baslik)), el('div.alt', {}, y.url)),
      el('div.dugmeler', {},
        el('button.ikon', { title: 'Düzenle', onclick: duzenle }, '✎'),
        el('button.ikon', { title: 'Sil', onclick: async () => { await ic.eylem('yerimi-sil', y.id); yerImleriCiz(); } }, '×'),
      ),
    );
    function duzenle() {
      const ad = el('input', { type: 'text', value: y.baslik, placeholder: 'Ad' });
      const adres = el('input', { type: 'text', value: y.url, placeholder: 'Adres' });
      satir.replaceChildren(el('div.duzenle', {}, ad, adres,
        el('button.birincil', { onclick: async () => { const s = await ic.eylem('yerimi-duzenle', y.id, ad.value, adres.value); if (s.tamam) yerImleriCiz(); else adres.focus(); } }, 'Kaydet'),
        el('button', { onclick: normal }, 'Vazgeç')));
      ad.focus();
    }
    normal();
    kart.append(satir);
  }
  icerik.replaceChildren(el('div.kap', {},
    el('h1', {}, 'Yer imleri'),
    yerImleri.length ? kart : el('p.bos', {}, 'Henüz yer imi yok. Bir sayfayı eklemek için adres çubuğundaki ☆ simgesine tıkla ya da Ctrl+D\'ye bas.'),
  ));
}

// --- İndirilenler ---
const DURUM = { tamam: 'Tamamlandı', iptal: 'İptal edildi', hata: 'Başarısız', kesildi: 'Yarıda kesildi', turbo: '⚡ TurboDownloader\'a aktarıldı' };
async function indirilenlerCiz() {
  const { indirilenler } = await ic.veri('indirilenler');
  const kart = el('div.kart');
  for (const i of indirilenler) {
    const iniyor = i.durum === 'iniyor';
    const yuzde = i.boyut ? Math.round((i.alinan / i.boyut) * 100) : null;
    const alt = iniyor
      ? `${boyut(i.alinan)}${i.boyut ? ' / ' + boyut(i.boyut) : ''}${yuzde !== null ? ` · %${yuzde}` : ''}${i.duraklatildi ? ' · duraklatıldı' : ''}`
      : `${DURUM[i.durum] || ''}${i.boyut ? ' · ' + boyut(i.boyut) : ''} · ${host(i.url)}${i.gecici ? ' · gizli oturum' : ''}`;
    const dugmeler = el('div.dugmeler');
    if (iniyor) dugmeler.append(el('button', { onclick: () => ic.eylem('indirme', 'iptal', i.id) }, 'İptal'));
    if (i.durum === 'tamam') {
      dugmeler.append(
        el('button', { onclick: async () => { const s = await ic.eylem('indirme', 'ac', i.id); if (s.hata) bildir(s.hata); } }, 'Aç'),
        el('button', { onclick: () => ic.eylem('indirme', 'klasor', i.id) }, 'Klasörde göster'),
      );
    }
    if (i.durum === 'turbo') {
      dugmeler.append(el('button', { onclick: async () => { const s = await ic.eylem('turbo-goster'); if (s.hata) bildir(s.hata); } }, 'TurboDownloader\'da göster'));
    }
    dugmeler.append(el('button.ikon', { title: 'Listeden kaldır', onclick: () => ic.eylem('indirme', 'sil', i.id) }, '×'));
    kart.append(el('div.satir', {},
      el('div.govde', {},
        el('div.ust', {}, i.dosya),
        el('div.alt' + (i.durum === 'tamam' ? '.durum-tamam' : i.durum === 'hata' || i.durum === 'kesildi' ? '.durum-hata' : ''), {}, alt),
        iniyor ? el('div.ilerleme', {}, el('div', { style: `width:${yuzde ?? 30}%` })) : null,
      ),
      dugmeler,
    ));
  }
  icerik.replaceChildren(el('div.kap', {},
    el('h1', {}, 'İndirilenler', el('span.bosluk'),
      el('button', { onclick: () => ic.eylem('indirme-klasoru') }, 'İndirme klasörünü aç'),
      indirilenler.length ? el('button', { onclick: () => ic.eylem('indirmeleri-temizle') }, 'Listeyi temizle') : null),
    el('p.bildirim', { id: 'bildirim' }),
    indirilenler.length ? kart : el('p.bos', {}, 'Henüz bir şey indirilmedi.'),
  ));
}

function bildir(metin) {
  const b = document.getElementById('bildirim');
  if (!b) return;
  b.textContent = metin;
  clearTimeout(b.z);
  b.z = setTimeout(() => { b.textContent = ''; }, 3000);
}

// --- Ayarlar ---
function anahtarDugme(acik, degisti) {
  const kutu = el('input', { type: 'checkbox', checked: acik, onchange: () => degisti(kutu.checked) });
  return el('label.anahtar', {}, kutu, el('span'));
}

function ayarSatiri(baslik, aciklama, kontrol) {
  return el('div.ayar', {}, el('div.govde', {}, el('div.ust', {}, baslik), aciklama ? el('div.alt', {}, aciklama) : null), kontrol);
}

const GUNCELLEME_METNI = {
  bekliyor: 'Henüz denetlenmedi.',
  denetleniyor: 'Yeni sürüm denetleniyor…',
  guncel: 'Umbra güncel.',
  gelistirme: 'Geliştirme sürümü: otomatik güncelleme yalnızca kurulu sürümde çalışır.',
  tasinabilir: 'Taşınabilir sürüm kendini güncelleyemez; güncel kalmak için kurulum sürümünü kullanın.',
};

function guncellemeSatiri(g) {
  let metin = GUNCELLEME_METNI[g.durum] || '';
  let dugme = el('button', { onclick: async () => { await ic.eylem('guncelleme-denetle'); bildir('Denetleniyor…'); } }, 'Güncellemeleri denetle');
  if (g.durum === 'iniyor') { metin = `Umbra ${g.surum} indiriliyor… %${g.yuzde || 0}`; dugme = null; }
  if (g.durum === 'hazir') {
    metin = `Umbra ${g.surum} indirildi. Yeniden başlatınca kurulacak (açık sekmeler geri gelir).`;
    dugme = el('button.birincil', { onclick: () => ic.eylem('guncelleme-yeniden') }, 'Yeniden başlat');
  }
  if (g.durum === 'hata') metin = `Denetlenemedi: ${g.hata}`;
  if (g.durum === 'gelistirme' || g.durum === 'tasinabilir') dugme = null;
  return ayarSatiri('Otomatik güncelleme', metin + ' Chromium güvenlik yamaları ve Tor her hafta otomatik olarak eklenir.', dugme);
}

function yedekKarti() {
  const secim = { yerImleri: true, gecmis: true, ayarlar: true };
  const kutu = (k, metin) => {
    const girdi = el('input', { type: 'checkbox', checked: true, onchange: () => { secim[k] = girdi.checked; } });
    return el('label', {}, girdi, metin);
  };
  const sonuc = el('p.bildirim');
  const yaz = (metin, hata) => { sonuc.textContent = metin; sonuc.style.color = hata ? '#ffb4ad' : ''; };
  return el('div.kart', {},
    el('div.secenekler', {},
      el('div.alt', { style: 'color:var(--soluk);font-size:13px' },
        'Verilerini tek bir .umbra dosyasına kaydedip başka bir bilgisayardaki Umbra\'ya aktarabilirsin. '
        + 'AI anahtarı ve sitelerdeki oturumlar güvenlik nedeniyle yedeğe girmez; yeni bilgisayarda yeniden girmen gerekir.'),
      kutu('yerImleri', 'Yer imleri'),
      kutu('gecmis', 'Tarama geçmişi'),
      kutu('ayarlar', 'Ayarlar (arama motoru, ana sayfa vb.)'),
      el('div.dugmeler', {},
        el('button.birincil', {
          onclick: async () => {
            const s = await ic.eylem('disa-aktar', secim);
            if (s.hata) return yaz(s.hata, true);
            if (!s.iptal) yaz(`Kaydedildi: ${s.dosya} (${s.yerImleri} yer imi, ${s.gecmis} geçmiş kaydı)`);
          },
        }, '⬆ Dışa aktar'),
        el('button', {
          onclick: async () => {
            const s = await ic.eylem('ice-aktar');
            if (s.hata) return yaz(s.hata, true);
            if (!s.iptal) yaz(`İçe aktarıldı: ${s.yerImleri} yeni yer imi, ${s.gecmis} geçmiş kaydı, ${s.ayarlar} ayar`);
          },
        }, '⬇ İçe aktar'),
      ),
      sonuc,
    ),
  );
}

async function ayarlarCiz() {
  const { ayarlar, motorlar, ozelMotorlar, aiAnahtar, turboAcik, guncelleme, surum } = await ic.veri('ayarlar');
  const kaydet = async (k, v) => { const s = await ic.eylem('ayar', k, v); bildir(s.tamam ? 'Kaydedildi' : 'Geçersiz değer'); };

  const motor = el('select', { onchange: () => kaydet('aramaMotoru', motor.value) },
    Object.entries(motorlar).map(([k, ad]) => el('option', { value: k, selected: k === ayarlar.aramaMotoru }, ad)));
  const ozelMotor = el('select', { onchange: () => kaydet('ozelAramaMotoru', ozelMotor.value) },
    Object.entries(ozelMotorlar).map(([k, ad]) => el('option', { value: k, selected: k === ayarlar.ozelAramaMotoru }, ad)));
  const ana = el('input', { type: 'text', value: ayarlar.anaSayfa, placeholder: 'Boş bırakılırsa arama motorunun sayfası' });
  ana.style.width = '320px';
  const anaKaydet = el('button', { onclick: () => kaydet('anaSayfa', ana.value.trim()) }, 'Kaydet');

  const temizlik = { gecmis: true, cerez: false, onbellek: true, indirmeler: false, izinler: false };
  const secenek = (k, metin) => {
    const kutu = el('input', { type: 'checkbox', checked: temizlik[k], onchange: () => { temizlik[k] = kutu.checked; } });
    return el('label', {}, kutu, metin);
  };

  icerik.replaceChildren(el('div.kap', {},
    el('h1', {}, 'Ayarlar'),
    el('p.bildirim', { id: 'bildirim' }),

    el('h2', {}, 'Arama ve başlangıç'),
    el('div.kart', {},
      ayarSatiri('Arama motoru', 'Normal sekmelerde adres çubuğuna yazılan aramalar için kullanılır.', motor),
      ayarSatiri('Gizli ve Tor sekmelerinde arama',
        'Bu sekmelerdeki aramalar gizlilik için Umbra AI\'ya gönderilmez; hesap gerektirmeyen, izleyicisiz bu motor kullanılır.', ozelMotor),
      ayarSatiri('Ana sayfa', 'Yeni sekmede ve ⌂ düğmesinde açılan sayfa.', el('div.dugmeler', {}, ana, anaKaydet)),
      ayarSatiri('Açılışta', 'Umbra açıldığında ne gösterilsin?', (() => {
        const s = el('select', { onchange: () => kaydet('acilis', s.value) },
          el('option', { value: 'yeni-sekme', selected: ayarlar.acilis !== 'devam' }, 'Yeni sekme sayfası'),
          el('option', { value: 'devam', selected: ayarlar.acilis === 'devam' }, 'Kaldığım yerden devam et'));
        return s;
      })()),
    ),

    el('h2', {}, 'Gizlilik ve güvenlik'),
    el('div.kart', {},
      ayarSatiri('Reklam ve izleyici engelleme', 'Bilinen reklam ve takip sunucularına giden istekler engellenir.',
        anahtarDugme(ayarlar.izleyiciEngelle, (v) => kaydet('izleyiciEngelle', v))),
    ),
    el('div.kart', { style: 'margin-top:10px' },
      [
        ['Sandbox ve site izolasyonu', 'Her site ayrı ve kısıtlı bir süreçte çalışır.'],
        ['HTTPS öncelikli', 'Şifresiz bağlantılar otomatik olarak HTTPS\'e yükseltilir.'],
        ['Şifreli DNS', 'Alan adı sorguları Cloudflare ve Quad9 üzerinden şifreli yapılır.'],
        ['Sertifika denetimi', 'Geçersiz sertifikalı sayfalar her zaman engellenir.'],
        ['Tor sekmesi', 'Gerçek IP adresinizi gizler; engelli ağlarda köprüler otomatik denenir.'],
      ].map(([b, a]) => el('div.koruma', {}, el('b', {}, '✓'), el('div', {}, el('div', {}, b), el('div.alt', { style: 'color:var(--soluk);font-size:12px' }, a)))),
    ),

    el('h2', {}, 'Yedekle ve taşı'),
    yedekKarti(),

    el('h2', {}, 'Tarama verilerini temizle'),
    el('div.kart', {},
      el('div.secenekler', {},
        secenek('gecmis', 'Tarama geçmişi'),
        secenek('cerez', 'Çerezler ve site verileri (sitelerden çıkış yapılır)'),
        secenek('onbellek', 'Önbellekteki resimler ve dosyalar'),
        secenek('indirmeler', 'İndirme listesi (dosyalar silinmez)'),
        secenek('izinler', 'Site izinleri (kamera, konum vb.)'),
        el('div', {}, el('button.birincil', { onclick: async () => { await ic.eylem('veri-temizle', temizlik); bildir('Seçilen veriler temizlendi'); } }, 'Verileri temizle')),
      ),
    ),

    el('h2', {}, 'İndirmeler'),
    el('div.kart', {},
      ayarSatiri('TurboDownloader entegrasyonu',
        `Normal sekmelerdeki indirmeler TurboDownloader'a gönderilir ve videoların üstünde "İndir ▼" kalite menüsü çıkar (şu an: ${turboAcik ? 'çalışıyor ✓' : 'kapalı; gerekince otomatik başlatılır'}). `
        + 'Gizli ve Tor sekmelerinde hiçbiri çalışmaz, çünkü TurboDownloader Tor kullanmadan gerçek IP adresinizle indirir.',
        anahtarDugme(ayarlar.turboIndir, (v) => kaydet('turboIndir', v))),
    ),

    el('h2', {}, 'Umbra AI'),
    el('div.kart', {},
      ayarSatiri('Claude bağlantısı', aiAnahtar ? 'API anahtarı kayıtlı (Windows şifrelemesiyle saklanıyor).' : 'Henüz API anahtarı girilmedi.',
        el('button', { onclick: () => ic.eylem('ai-ayar') }, 'AI panelini aç')),
    ),

    el('h2', {}, 'Hakkında'),
    el('div.kart', {},
      ayarSatiri(`Umbra ${surum.umbra}`, `Chromium ${surum.chromium} · Electron ${surum.electron}`, null),
      guncellemeSatiri(guncelleme),
    ),
  ));
}

// --- Umbra Arama ---
function kacir(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Basit ve güvenli markdown: önce HTML kaçırılır, sonra sınırlı biçimler uygulanır. ⟦n⟧ işaretleri kaynak numarasına dönüşür.
function markdown(metin) {
  const satirIci = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/⟦([\d,]+)⟧/g, (_m, n) => n.split(',').map((k) => `<sup><a class="atif" data-k="${k}">${k}</a></sup>`).join(''));
  let html = '';
  let liste = null;
  const kapat = () => { if (liste) { html += `</${liste}>`; liste = null; } };
  for (const satir of kacir(metin).split('\n')) {
    const madde = /^\s*[-*•]\s+(.*)/.exec(satir);
    const sira = /^\s*\d+[.)]\s+(.*)/.exec(satir);
    const baslik = /^#{1,4}\s+(.*)/.exec(satir);
    if (madde || sira) {
      const tur = madde ? 'ul' : 'ol';
      if (liste !== tur) { kapat(); html += `<${tur}>`; liste = tur; }
      html += `<li>${satirIci((madde || sira)[1])}</li>`;
    } else if (baslik) { kapat(); html += `<h3>${satirIci(baslik[1])}</h3>`; }
    else if (satir.trim()) { kapat(); html += `<p>${satirIci(satir)}</p>`; }
  }
  kapat();
  return html;
}

// buyuk: yeni sekme sayfasındaki kutu; yazılan adres veya arama, ayarlardaki arama motoruyla açılır.
// Sonuç sayfasındaki kutu ise her zaman Umbra Arama'da arar.
function aramaKutusu(deger, buyuk, yerTutucu) {
  const girdi = el('input', { type: 'search', value: deger || '', placeholder: yerTutucu, autocomplete: 'off', spellcheck: false });
  const form = el('form.arama-kutusu' + (buyuk ? '.buyuk' : ''), {
    onsubmit: (e) => {
      e.preventDefault();
      const q = girdi.value.trim();
      if (q) ic.eylem('ac', buyuk ? q : 'umbra://ara?q=' + encodeURIComponent(q));
    },
  }, el('span.buyutec', {}, '🔍'), girdi);
  return { form, girdi };
}

async function yeniSekmeCiz() {
  const { aiAnahtar, varsayilan, kisayollar } = await ic.veri('ara');
  const { form, girdi } = aramaKutusu('', true, varsayilan ? 'Umbra ile ara veya bir soru sor' : 'Ara veya adres yaz');
  const notlar = [];
  if (!aiAnahtar) {
    notlar.push(el('p.not-satiri', {}, 'Umbra Arama, Claude ile web\'de arayıp kaynaklı yanıt verir. Kullanmak için ',
      el('a.bag', { href: '#', onclick: (e) => { e.preventDefault(); ic.eylem('ai-ayar'); } }, 'AI anahtarını gir'), '.'));
  } else if (!varsayilan) {
    notlar.push(el('p.not-satiri', {}, el('a.bag', {
      href: '#',
      onclick: async (e) => { e.preventDefault(); await ic.eylem('ara-motor'); e.target.replaceWith('Umbra Arama artık varsayılan arama motorun ✓'); },
    }, 'Adres çubuğundaki aramalar için Umbra Arama\'yı varsayılan yap')));
  }
  const kutucuklar = kisayollar.map((y) => el('a.kutucuk', {
    href: '#', title: y.url,
    onclick: (e) => { e.preventDefault(); ic.eylem('ac', y.url, e.ctrlKey); },
  }, el('span.harf', {}, (host(y.url).replace(/^www\./, '')[0] || '?').toUpperCase()), el('span.ad', {}, y.baslik || host(y.url))));
  icerik.replaceChildren(el('div.yeni-sekme', {},
    el('img.buyuk-logo', { src: 'logo.png', alt: '' }),
    el('h1.marka', {}, 'Umbra'),
    form,
    ...notlar,
    kutucuklar.length ? el('div.kutucuklar', {}, kutucuklar) : null,
  ));
  girdi.focus();
}

// Google'daki gibi arama türü sekmeleri. Umbra'nın kendi web dizini olmadığı için her tür, o alanda en iyi
// sonucu veren servisi açar; "AI Modu" bu sayfadır, "Araçlar" AI aramasına zaman filtresi uygular.
const ZAMAN_ADLARI = { '': 'Her zaman', gun: 'Son 24 saat', hafta: 'Son 1 hafta', ay: 'Son 1 ay', yil: 'Son 1 yıl' };

function dikeySekmeler(q, zaman, yedekMotor) {
  const k = encodeURIComponent(q);
  const ac = (url) => (e) => { e.preventDefault(); ic.eylem('ac', url, e.ctrlKey || e.button === 1); };
  const sekme = (ad, url, aktif) => el('a.dikey' + (aktif ? '.aktif' : ''), {
    href: '#', title: url || '', onclick: url ? ac(url) : (e) => e.preventDefault(), onauxclick: url ? ac(url) : null,
  }, ad);
  const acilir = (ad, ogeler, sag) => {
    const liste = el('div.acilir-liste' + (sag ? '.sag' : ''), { hidden: true }, ogeler);
    const dugme = el('a.dikey', { href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); liste.hidden = !liste.hidden; } }, ad + ' ▾');
    document.addEventListener('click', () => { liste.hidden = true; });
    return el('span.acilir', {}, dugme, liste);
  };
  const oge = (ad, url, secili) => el('a.acilir-oge' + (secili ? '.secili' : ''), { href: '#', onclick: ac(url) }, ad);
  return el('nav.dikeyler', {},
    sekme('✨ AI Modu', null, true),
    sekme('Tümü', yedekMotor.ara + k),
    sekme('Görseller', 'https://search.brave.com/images?q=' + k),
    sekme('Videolar', 'https://search.brave.com/videos?q=' + k),
    sekme('Kısa videolar', 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' #shorts')),
    sekme('Alışveriş', 'https://www.google.com/search?udm=28&q=' + k),
    sekme('Haberler', 'https://search.brave.com/news?q=' + k),
    sekme('Yerler', 'https://www.google.com/maps/search/' + k),
    acilir('Daha fazla', [
      oge('Kitaplar', 'https://www.google.com/search?udm=36&q=' + k),
      oge('Akademik', 'https://scholar.google.com/scholar?q=' + k),
      oge('Uçuşlar', 'https://www.google.com/travel/flights?q=' + k),
      oge('Finans', 'https://www.google.com/finance?q=' + k),
      oge('Çeviri', 'https://translate.google.com/?sl=auto&tl=tr&text=' + k),
      oge('Vikipedi', 'https://tr.wikipedia.org/w/index.php?search=' + k),
    ]),
    el('span.bosluk'),
    acilir(zaman ? ZAMAN_ADLARI[zaman] : 'Araçlar', Object.entries(ZAMAN_ADLARI).map(([z, ad]) =>
      oge(ad, 'umbra://ara?' + new URLSearchParams({ q, ...(z ? { zaman: z } : {}) }), z === zaman)), true),
  );
}

async function aramaCiz(q) {
  document.title = `${q} - Umbra Arama`;
  const { form } = aramaKutusu(q, false, 'Umbra ile ara veya bir soru sor');
  const yanit = el('div.yanit-metni.yaziyor');
  const kaynakAlani = el('div.kaynaklar');
  const durumYazi = el('span', {}, '🔍 Web\'de aranıyor…');
  const durumSure = el('span.sure');
  const durum = el('div.yanit-durum', {}, el('span.nokta'), durumYazi, durumSure);
  const yanitKarti = el('section.yanit-karti', {}, el('div.yanit-baslik', {}, '✨ Umbra yanıtı'), durum, yanit, kaynakAlani);
  const sonucAlani = el('section.sonuclar');
  const { yedekMotor } = await ic.veri('ara');
  const yedekAdres = yedekMotor.ara + encodeURIComponent(q);
  const zaman = new URLSearchParams(location.search).get('zaman') || '';
  icerik.replaceChildren(el('div.arama-sayfasi', {},
    el('header.arama-ust', {}, el('a.mini-logo', { href: '#', title: 'Umbra Arama', onclick: (e) => { e.preventDefault(); ic.eylem('ac', 'umbra://ara'); } },
      el('img', { src: 'logo.png', alt: '' })), form),
    dikeySekmeler(q, zaman, yedekMotor),
    yanitKarti,
    sonucAlani,
    el('p.alt-bilgi', {}, 'Aradığını bulamadın mı? ', baglanti(yedekAdres, `Bu aramayı ${yedekMotor.ad} ile aç`)),
  ));

  // Web sonuçları, Claude aramayı yapar yapmaz gösterilir (AI yanıtı beklenmez); tekrar edenler atlanır
  const gosterilen = new Set();
  const sonuclariEkle = (liste) => {
    const yeni = liste.filter((r) => r.url && !gosterilen.has(r.url));
    if (!yeni.length) return;
    if (!gosterilen.size) sonucAlani.append(el('h2', {}, 'Web sonuçları'));
    for (const r of yeni) {
      gosterilen.add(r.url);
      sonucAlani.append(el('div.sonuc', {},
        el('div.sonuc-adres', {}, host(r.url).replace(/^www\./, '') + (r.yas ? ' · ' + r.yas : '')),
        el('div.sonuc-baslik', {}, baglanti(r.url, r.baslik))));
    }
  };

  // Aşama ve geçen süre: kullanıcı beklerken neyin olduğunu görür
  const baslangic = Date.now();
  const sayac = setInterval(() => { durumSure.textContent = ` · ${Math.round((Date.now() - baslangic) / 1000)} sn`; }, 1000);
  aktifDurumDinleyici = (d) => {
    if (d.asama === 'aranıyor' && !gosterilen.size) durumYazi.textContent = '🔍 Web\'de aranıyor…';
    else if (d.asama === 'sonuclar') {
      sonuclariEkle(d.sonuclar || []);
      durumYazi.textContent = `📄 ${gosterilen.size} sonuç bulundu, okunuyor…`;
    } else if (d.asama === 'yaziyor') durumYazi.textContent = '✍ Yanıt yazılıyor…';
  };

  let akan = '';
  aktifParcaDinleyici = (parca) => {
    akan += parca;
    durum.hidden = true;
    // Akış sırasında sondaki ham "KAYNAKLAR" listesi gösterilmez; bitince düzenli kaynak listesine dönüşür
    yanit.innerHTML = markdown(akan.split(/\n\s*\**KAYNAKLAR/i)[0]);
  };
  const sonuc = await ic.eylem('ara', q, zaman);
  aktifParcaDinleyici = null;
  aktifDurumDinleyici = null;
  clearInterval(sayac);
  yanit.classList.remove('yaziyor');
  durum.hidden = true;
  if (Array.isArray(sonuc.sonuclar)) sonuclariEkle(sonuc.sonuclar);

  if (sonuc.hata || sonuc.reddedildi || sonuc.durduruldu) {
    yanitKarti.classList.add('hata');
    yanit.textContent = sonuc.hata || (sonuc.reddedildi ? 'Bu arama güvenlik politikası nedeniyle yanıtlanmadı.' : 'Arama durduruldu.');
    if (sonuc.hata && /anahtar/i.test(sonuc.hata)) {
      yanit.append(' ', el('a.bag', { href: '#', onclick: (e) => { e.preventDefault(); ic.eylem('ai-ayar'); } }, 'AI anahtarını gir'));
    }
    return;
  }

  // Atıflı son hali: her parçanın sonuna kaynak numaraları eklenir
  const metin = sonuc.parcalar.map((p) => p.metin + (p.kaynaklar.length ? `⟦${p.kaynaklar.join(',')}⟧` : '')).join('');
  yanit.innerHTML = markdown(metin);
  for (const a of yanit.querySelectorAll('a.atif')) {
    const k = sonuc.kaynaklar[Number(a.dataset.k) - 1];
    if (k) { a.title = k.baslik; a.href = '#'; a.onclick = (e) => { e.preventDefault(); ic.eylem('ac', k.url, e.ctrlKey); }; }
  }
  if (sonuc.kaynaklar.length) {
    kaynakAlani.append(...sonuc.kaynaklar.map((k, i) => el('a.kaynak', {
      href: '#', title: k.url,
      onclick: (e) => { e.preventDefault(); ic.eylem('ac', k.url, e.ctrlKey); },
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); ic.eylem('ac', k.url, true); } },
    }, el('b', {}, String(i + 1)), el('span', {}, host(k.url).replace(/^www\./, '')))));
  }
  if (sonuc.onbellekten) durum.replaceWith(el('div.yanit-durum', {}, 'Önbellekten gösteriliyor'));
}

let aktifParcaDinleyici = null;
let aktifDurumDinleyici = null;
ic.parcaDinle((parca) => aktifParcaDinleyici?.(parca));
ic.aramaDurumuDinle((d) => aktifDurumDinleyici?.(d));
// Arama sürerken sayfadan çıkılırsa istek iptal edilir (boşuna ücretlendirilmesin)
window.addEventListener('pagehide', () => { if (aktifParcaDinleyici) ic.eylem('ara-durdur'); });

function araCiz() {
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  return q ? aramaCiz(q) : yeniSekmeCiz();
}

const CIZICILER = { ara: araCiz, gecmis: gecmisCiz, 'yer-imleri': yerImleriCiz, indirilenler: indirilenlerCiz, ayarlar: ayarlarCiz };

// Sayfa, adresin # kısmından seçilir; iç sayfalar arası geçişte yalnızca bu kısım değişir
function yukle() {
  sayfa = CIZICILER[location.hash.slice(1)] ? location.hash.slice(1) : 'gecmis';
  document.title = BASLIKLAR[sayfa];
  document.body.classList.toggle('arama-modu', sayfa === 'ara');
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('aktif', a.dataset.sayfa === sayfa);
  aramaMetni = '';
  icerik.scrollTop = 0;
  CIZICILER[sayfa]();
}
window.addEventListener('hashchange', yukle);
yukle();
// Fare tuşu basılıyken sayfa yeniden çizilmez: aksi halde düğme, basma ile bırakma arasında yenisiyle
// değişir ve tıklama kaybolur (ör. indirme sürerken "İptal"). Bekleyen çizim tuş bırakılınca yapılır.
let fareBasili = false;
let bekleyenCizim = null;
window.addEventListener('pointerdown', () => { fareBasili = true; }, true);
window.addEventListener('pointerup', () => {
  fareBasili = false;
  // tıklama olayı işlendikten sonra çiz
  if (bekleyenCizim) setTimeout(() => { const c = bekleyenCizim; bekleyenCizim = null; if (c === sayfa) CIZICILER[c](); }, 0);
}, true);

ic.degisinceDinle((s) => {
  // Ayarlar sayfası, kullanıcı yazarken yeniden çizilip girdiyi kaybetmesin diye yalnızca diğer sayfalarda yenilenir
  if (s === sayfa && s !== 'ayarlar') {
    if (fareBasili) bekleyenCizim = s;
    else CIZICILER[s]();
  }
  if (s === 'guncelleme' && sayfa === 'ayarlar') {
    // Yalnızca güncelleme satırını yenile; diğer ayarlarda yazılanlar kaybolmasın
    ic.veri('ayarlar').then(({ guncelleme }) => {
      const eski = [...document.querySelectorAll('.ayar')].find((a) => a.textContent.startsWith('Otomatik güncelleme'));
      eski?.replaceWith(guncellemeSatiri(guncelleme));
    });
  }
});
