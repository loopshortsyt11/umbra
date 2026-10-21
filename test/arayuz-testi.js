'use strict';
// Umbra arayüz testi: düğmelere gerçek fare/klavye olaylarıyla basar ve sonucu ana süreçteki durumdan doğrular.
// Çalıştırma (yalnızca geliştirme sürümü): node_modules\electron\dist\electron.exe . --arayuz-testi
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function arayuzTesti(u) {
  const sonuclar = [];
  const ui = () => u.arayuz.webContents;
  const aktifWc = () => u.aktifSekme().view.webContents;
  const turler = () => [...u.sekmeler.values()].map((s) => s.tur);
  u.veri.ayarla('turboIndir', false); // test indirmeleri TurboDownloader'a gitmesin

  async function kosul(fn, ms = 8000, aciklama = 'koşul') {
    const son = Date.now() + ms;
    while (Date.now() < son) {
      try { if (await fn()) return; } catch {}
      await bekle(100);
    }
    throw new Error(`${aciklama} ${ms} ms içinde gerçekleşmedi`);
  }

  async function konum(secici, wc) {
    return wc.executeJavaScript(`(() => {
      const e = document.querySelector(${JSON.stringify(secici)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), g: r.width };
    })()`);
  }

  async function tikla(secici, { wc = ui(), button = 'left' } = {}) {
    // Kullanıcı gibi davran: sekme çubuğu ana süreçteki güncel durumu gösterene kadar tıklama
    if (wc === ui()) {
      await kosul(async () => (await ui().executeJavaScript(
        `document.querySelectorAll('#sekme-listesi .sekme').length + '|' + (document.querySelector('#sekme-listesi .sekme.aktif .baslik')?.textContent ?? '')`,
      )).startsWith(u.sekmeler.size + '|'), 3000, 'sekme çubuğunun güncellenmesi');
      await bekle(80);
    }
    const k = await konum(secici, wc);
    if (!k || !k.g) throw new Error(`öğe bulunamadı: ${secici}`);
    wc.sendInputEvent({ type: 'mouseMove', x: k.x, y: k.y });
    wc.sendInputEvent({ type: 'mouseDown', x: k.x, y: k.y, button, clickCount: 1 });
    await bekle(60); // gerçek bir tıklamadaki bas-bırak arası
    wc.sendInputEvent({ type: 'mouseUp', x: k.x, y: k.y, button, clickCount: 1 });
    await bekle(350);
  }

  async function yazEnter(secici, metin, wc = ui()) {
    await tikla(secici, { wc });
    await wc.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(secici)}); e.focus(); e.select && e.select(); })()`);
    await wc.insertText(metin);
    await bekle(150);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await bekle(300);
  }

  const filtre = process.env.UMBRA_TEST_FILTRE;
  async function test(ad, fn) {
    if (filtre && !ad.includes(filtre)) return;
    try {
      await fn();
      sonuclar.push({ durum: 'GEÇTİ', ad });
    } catch (h) {
      sonuclar.push({ durum: 'KALDI', ad, hata: h.message });
    }
  }

  const adresBekle = (parca, ms) => kosul(() => u.sekmeAdresi(u.aktifSekme()).includes(parca), ms, `adres "${parca}"`);

  // --- Sekmeler ---
  await test('+ düğmesi yeni sekme açar', async () => {
    const n = u.sekmeler.size;
    await tikla('#yeni-sekme');
    await kosul(() => u.sekmeler.size === n + 1, 3000, 'sekme sayısı artışı');
    await adresBekle('umbra://ara', 3000);
  });

  await test('× düğmesi etkin sekmeyi kapatır', async () => {
    await tikla('#yeni-sekme');
    const n = u.sekmeler.size;
    await tikla('#sekme-listesi .sekme.aktif .kapat');
    await kosul(() => u.sekmeler.size === n - 1, 3000, 'sekme sayısı azalışı');
  });

  await test('× düğmesi arka plandaki sekmeyi kapatır', async () => {
    while (u.sekmeler.size < 3) { await tikla('#yeni-sekme'); }
    const n = u.sekmeler.size;
    const aktifId = u.aktifSekme().id;
    const sira = [...u.sekmeler.keys()];
    const hedef = sira.findIndex((id) => id !== aktifId);
    const hedefId = sira[hedef];
    await tikla(`#sekme-listesi .sekme:nth-child(${hedef + 1}) .kapat`);
    await kosul(() => u.sekmeler.size === n - 1 && !u.sekmeler.has(hedefId), 3000, 'arka plan sekmesinin kapanması');
    if (u.aktifSekme().id !== aktifId) throw new Error('arka plan sekmesini kapatmak etkin sekmeyi değiştirdi');
  });

  await test('Art arda 3 sekme × ile hızlıca kapanır', async () => {
    for (let i = 0; i < 3; i++) await tikla('#yeni-sekme');
    const n = u.sekmeler.size;
    for (let i = 0; i < 3; i++) {
      const k = await konum('#sekme-listesi .sekme.aktif .kapat', ui());
      ui().sendInputEvent({ type: 'mouseDown', x: k.x, y: k.y, button: 'left', clickCount: 1 });
      await bekle(40);
      ui().sendInputEvent({ type: 'mouseUp', x: k.x, y: k.y, button: 'left', clickCount: 1 });
      await bekle(120);
    }
    await kosul(() => u.sekmeler.size === n - 3, 3000, 'üç sekmenin kapanması');
  });

  await test('Sekme yüklenirken × ile kapanır', async () => {
    await yazEnter('#adres', 'https://example.com');
    const n = u.sekmeler.size;
    aktifWc().reload();
    await tikla('#sekme-listesi .sekme.aktif .kapat');
    await kosul(() => u.sekmeler.size === n - 1, 3000, 'yüklenen sekmenin kapanması');
  });

  await test('Orta tık sekmeyi kapatır', async () => {
    await tikla('#yeni-sekme');
    const n = u.sekmeler.size;
    await tikla('#sekme-listesi .sekme.aktif', { button: 'middle' });
    await kosul(() => u.sekmeler.size === n - 1, 3000, 'orta tıkla kapanma');
  });

  await test('Sekmeye tıklayınca o sekmeye geçilir', async () => {
    while (u.sekmeler.size < 2) { await tikla('#yeni-sekme'); }
    const aktifId = u.aktifSekme().id;
    const sira = [...u.sekmeler.keys()];
    const hedef = sira.findIndex((id) => id !== aktifId);
    await tikla(`#sekme-listesi .sekme:nth-child(${hedef + 1}) .baslik`);
    await kosul(() => u.aktifSekme().id === sira[hedef], 3000, 'sekme geçişi');
  });

  // --- Gezinme ---
  await test('Adres çubuğuna yazıp Enter ile gidilir', async () => {
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'example.com');
    await adresBekle('example.com', 15000);
  });

  await test('Geri ve İleri düğmeleri', async () => {
    await yazEnter('#adres', 'https://example.org');
    await adresBekle('example.org', 15000);
    await kosul(async () => !(await ui().executeJavaScript('document.getElementById("geri").disabled')), 3000, 'geri düğmesinin etkinleşmesi');
    await tikla('#geri');
    await adresBekle('example.com', 15000);
    await tikla('#ileri');
    await adresBekle('example.org', 15000);
  });

  await test('Yenile düğmesi sayfayı yeniden yükler', async () => {
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    const yuklendi = new Promise((r) => aktifWc().once('did-start-loading', r));
    await tikla('#yenile');
    await Promise.race([yuklendi, bekle(3000).then(() => { throw new Error('yeniden yükleme başlamadı'); })]);
  });

  await test('Yıldız yer imi ekler ve kaldırır', async () => {
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    const url = u.sekmeAdresi(u.aktifSekme());
    if (u.veri.yerImiMi(url)) await tikla('#yildiz');
    await tikla('#yildiz');
    await kosul(() => u.veri.yerImiMi(url), 3000, 'yer iminin eklenmesi');
    await tikla('#yildiz');
    await kosul(() => !u.veri.yerImiMi(url), 3000, 'yer iminin kaldırılması');
  });

  await test('Sayfada bul eşleşmeleri sayar', async () => {
    ui().send('bul:ac');
    await bekle(300);
    await ui().executeJavaScript('document.getElementById("bul-metin").focus()');
    await ui().insertText('Example');
    await kosul(async () => /^\d+\/\d+$/.test(await ui().executeJavaScript('document.getElementById("bul-sonuc").textContent'))
      && !(await ui().executeJavaScript('document.getElementById("bul-sonuc").textContent')).startsWith('0/'), 5000, 'eşleşme sayısı');
    await tikla('#bul-kapat');
    await kosul(async () => ui().executeJavaScript('document.getElementById("bul").hidden'), 2000, 'bul kutusunun kapanması');
  });

  await test('Ana sayfa düğmesi yeni sekme sayfasını açar', async () => {
    await tikla('#ana');
    await adresBekle('umbra://ara', 5000);
  });

  await test('Yeni sekme sayfasındaki arama kutusu adrese gider', async () => {
    await kosul(async () => (await konum('.arama-kutusu input', aktifWc())) !== null, 5000, 'arama kutusunun yüklenmesi');
    await yazEnter('.arama-kutusu input', 'example.net', aktifWc());
    await adresBekle('example.net', 15000);
  });

  // --- Özel sekmeler ---
  await test('🕶 düğmesi gizli sekme açar', async () => {
    const n = turler().filter((t) => t === 'gizli').length;
    await tikla('#yeni-gizli');
    await kosul(() => turler().filter((t) => t === 'gizli').length === n + 1 && u.aktifSekme().tur === 'gizli', 3000, 'gizli sekme');
    await tikla('#sekme-listesi .sekme.aktif .kapat');
    await kosul(() => turler().filter((t) => t === 'gizli').length === n, 3000, 'gizli sekmenin kapanması');
  });

  await test('🧅 düğmesi Tor sekmesi açar', async () => {
    const n = turler().filter((t) => t === 'tor').length;
    await tikla('#yeni-tor');
    await kosul(() => turler().filter((t) => t === 'tor').length === n + 1 && u.aktifSekme().tur === 'tor', 3000, 'Tor sekmesi');
    await tikla('#sekme-listesi .sekme.aktif .kapat');
    await kosul(() => turler().filter((t) => t === 'tor').length === n, 3000, 'Tor sekmesinin kapanması');
  });

  // --- AI paneli ---
  await test('✨ düğmesi AI panelini açar, panelin × düğmesi kapatır', async () => {
    await tikla('#ai');
    await kosul(() => u.panelAcik, 3000, 'panelin açılması');
    await kosul(() => u.panel && !u.panel.webContents.isLoading(), 5000, 'panelin yüklenmesi');
    await bekle(300);
    await tikla('#kapat', { wc: u.panel.webContents });
    await kosul(() => !u.panelAcik, 3000, 'panelin kapanması');
    await tikla('#ai');
    await kosul(() => u.panelAcik, 3000, 'panelin yeniden açılması');
    await tikla('#ai');
    await kosul(() => !u.panelAcik, 3000, 'panelin düğmeyle kapanması');
  });

  // --- İç sayfalar ---
  await test('İç sayfa menüsü sayfalar arasında geçer', async () => {
    await yazEnter('#adres', 'umbra://gecmis');
    await adresBekle('umbra://gecmis', 5000);
    await bekle(500);
    await tikla('nav a[data-sayfa="ayarlar"]', { wc: aktifWc() });
    await adresBekle('umbra://ayarlar', 5000);
    await kosul(async () => (await aktifWc().executeJavaScript('document.title')) === 'Ayarlar', 3000, 'Ayarlar sayfasının çizilmesi');
  });

  await test('Ayarlar sayfasındaki anahtar düğmesi ayarı değiştirir', async () => {
    const once = u.veri.ayarlar.oturumuGeriYukle;
    await kosul(async () => (await konum('.anahtar span', aktifWc())) !== null, 3000, 'anahtarın çizilmesi');
    await tikla('.anahtar span', { wc: aktifWc() });
    await kosul(() => u.veri.ayarlar.oturumuGeriYukle === !once, 3000, 'ayarın değişmesi');
    await tikla('.anahtar span', { wc: aktifWc() });
    await kosul(() => u.veri.ayarlar.oturumuGeriYukle === once, 3000, 'ayarın geri dönmesi');
  });

  await test('İndirme sırasında İptal düğmesi çalışır', async () => {
    await yazEnter('#adres', 'https://proof.ovh.net/files/100Mb.dat');
    await kosul(() => u.tumIndirmeler().some((i) => i.durum === 'iniyor'), 15000, 'indirmenin başlaması');
    await kosul(async () => !(await ui().executeJavaScript('document.getElementById("indirme").hidden')), 3000, 'indirme düğmesinin görünmesi');
    await tikla('#indirme');
    await adresBekle('umbra://indirilenler', 5000);
    await kosul(async () => (await konum('.dugmeler button:not(.ikon)', aktifWc())) !== null, 5000, 'İptal düğmesinin çizilmesi');
    await bekle(800); // ilerleme güncellemeleri sayfayı birkaç kez yenilesin
    await tikla('.dugmeler button:not(.ikon)', { wc: aktifWc() });
    await kosul(() => !u.tumIndirmeler().some((i) => i.durum === 'iniyor'), 5000, 'indirmenin iptali');
  });

  // --- ⋮ menüsü (Windows menüsü otomatik tıklanamadığı için öğelerin işlevleri doğrudan çağrılır) ---
  const menuOgesi = (ad) => {
    const o = u.anaMenuOgeleri().find((x) => x.label === ad);
    if (!o) throw new Error(`menüde "${ad}" yok`);
    o.click();
  };
  for (const [ad, adres] of [['Geçmiş', 'umbra://gecmis'], ['İndirilenler', 'umbra://indirilenler'], ['Yer imleri', 'umbra://yer-imleri'], ['Ayarlar', 'umbra://ayarlar']]) {
    await test(`⋮ menüsü → ${ad}`, async () => {
      menuOgesi(ad);
      await adresBekle(adres, 5000);
    });
  }
  await test('⋮ menüsü → Yeni sekme / gizli / Tor', async () => {
    const n = u.sekmeler.size;
    menuOgesi('Yeni sekme'); menuOgesi('Yeni gizli sekme'); menuOgesi('Yeni Tor sekmesi');
    await kosul(() => u.sekmeler.size === n + 3, 3000, 'üç sekme');
    if (u.aktifSekme().tur !== 'tor') throw new Error('son açılan Tor sekmesi değil');
    const iz = [];
    for (let i = 0; i < 3; i++) {
      const once = `${u.aktifSekme().tur}#${u.aktifSekme().id}`;
      await tikla('#sekme-listesi .sekme.aktif .kapat');
      iz.push(`${once}→${u.sekmeler.size}`);
    }
    await kosul(() => u.sekmeler.size === n, 3000, `sekmelerin kapanması [${iz.join(', ')}; beklenen ${n}]`);
  });
  await test('⋮ menüsü → Umbra AI paneli aç/kapat', async () => {
    menuOgesi('✨ Umbra AI');
    await kosul(() => u.panelAcik, 3000, 'panelin açılması');
    menuOgesi('✨ Umbra AI');
    await kosul(() => !u.panelAcik, 3000, 'panelin kapanması');
  });

  // --- Geçmiş sayfası ---
  await test('Geçmiş: kayda tıklayınca açılır, × ile silinir', async () => {
    await yazEnter('#adres', 'umbra://gecmis');
    await adresBekle('umbra://gecmis', 5000);
    await kosul(async () => (await konum('.kart .satir button.ikon', aktifWc())) !== null, 5000, 'geçmiş listesinin çizilmesi');
    const n = u.veri.gecmis.length;
    await tikla('.kart .satir button.ikon', { wc: aktifWc() });
    await kosul(() => u.veri.gecmis.length === n - 1, 3000, 'kaydın silinmesi');
    await kosul(async () => (await konum('.kart .satir a.bag', aktifWc())) !== null, 3000, 'listenin yeniden çizilmesi');
    await tikla('.kart .satir a.bag', { wc: aktifWc() });
    await kosul(() => u.sekmeAdresi(u.aktifSekme()).startsWith('http'), 15000, 'kaydın açılması');
  });

  // --- Yer imleri sayfası ---
  await test('Yer imleri: düzenle ve sil', async () => {
    if (!u.veri.yerImiMi('https://example.com/')) u.veri.yerImiDegistir('https://example.com/', 'Örnek');
    await yazEnter('#adres', 'umbra://yer-imleri');
    await adresBekle('umbra://yer-imleri', 5000);
    await kosul(async () => (await konum('button[title="Düzenle"]', aktifWc())) !== null, 5000, 'yer imi listesinin çizilmesi');
    await tikla('button[title="Düzenle"]', { wc: aktifWc() });
    await aktifWc().executeJavaScript('document.querySelector(".duzenle input").value = ""');
    await aktifWc().executeJavaScript('document.querySelector(".duzenle input").focus()');
    await aktifWc().insertText('Yeni Ad');
    await tikla('.duzenle button.birincil', { wc: aktifWc() });
    await kosul(() => u.veri.yerImleri.some((y) => y.baslik === 'Yeni Ad'), 3000, 'adın değişmesi');
    const n = u.veri.yerImleri.length;
    await kosul(async () => (await konum('button[title="Sil"]', aktifWc())) !== null, 3000, 'listenin yeniden çizilmesi');
    await tikla('button[title="Sil"]', { wc: aktifWc() });
    await kosul(() => u.veri.yerImleri.length === n - 1, 3000, 'yer iminin silinmesi');
  });

  // --- AI paneli düğmeleri ---
  await test('AI paneli: ⚙ ayar ekranı ve ⟲ yeni sohbet', async () => {
    await tikla('#ai');
    await kosul(() => u.panelAcik && u.panel && !u.panel.webContents.isLoading(), 5000, 'panelin açılması');
    await bekle(300);
    const pw = u.panel.webContents;
    // anahtar yokken kurulum ekranı görünür; ⚙ ile görünürlük değişmemeli, hata da vermemeli
    await kosul(async () => !(await pw.executeJavaScript('document.getElementById("kurulum").hidden')), 3000, 'kurulum ekranı');
    await tikla('#ayar', { wc: pw });
    await tikla('#yeni', { wc: pw });
    await kosul(async () => !pw.isLoading() && !(await pw.executeJavaScript('document.getElementById("kurulum").hidden')), 5000, 'yeni sohbet sonrası panel');
    await tikla('#kapat', { wc: pw });
    await kosul(() => !u.panelAcik, 3000, 'panelin kapanması');
  });

  // --- Gizli/Tor başlangıç sayfası ve arama motorları ---
  await test('Gizli sekme Umbra başlangıç sayfasıyla açılır, araması seçili motora gider', async () => {
    await tikla('#yeni-gizli');
    await kosul(() => aktifWc().getURL().includes('baslangic.html'), 5000, 'başlangıç sayfası');
    await kosul(async () => (await aktifWc().executeJavaScript('document.title')) === 'Yeni gizli sekme', 3000, 'sayfa başlığı');
    if (u.sekmeAdresi(u.aktifSekme()) !== '') throw new Error('adres çubuğu boş değil');
    await yazEnter('#q', 'umbra tarayici', aktifWc());
    await kosul(() => aktifWc().getURL().startsWith('https://search.brave.com/search?q=umbra'), 15000, 'Brave Search sonucu');
    if (u.veri.gecmis.some((g) => g.url.includes('search.brave.com'))) throw new Error('gizli sekmeden geçmişe kayıt düştü');
    await tikla('#sekme-listesi .sekme.aktif .kapat');
  });

  await test('Tor sekmesi bağlanınca Umbra başlangıç sayfasını gösterir', async () => {
    await tikla('#yeni-tor');
    await kosul(() => aktifWc().getURL().includes('baslangic.html'), 180000, 'Tor bağlantısı ve başlangıç sayfası');
    await kosul(async () => (await aktifWc().executeJavaScript('document.getElementById("etiket").textContent')).includes('Tor'), 3000, 'Tor etiketi');
    await tikla('#sekme-listesi .sekme.aktif .kapat');
  });

  await test('AI anahtarı yokken adres çubuğu araması izleyicisiz motora gider', async () => {
    // test, anahtarın olmadığı geçici bir veri klasöründe çalışır; varsayılan motor Umbra Arama
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'umbra tarayici deneme');
    await kosul(() => u.sekmeAdresi(u.aktifSekme()).startsWith('https://search.brave.com/search?q=umbra'), 15000, 'Brave Search sonucu');
  });

  await test('Ayarlar: gizli/Tor arama motoru seçimi', async () => {
    await yazEnter('#adres', 'umbra://ayarlar');
    await adresBekle('umbra://ayarlar', 5000);
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll("select").length')) === 2, 3000, 'iki arama motoru seçimi');
    await aktifWc().executeJavaScript(`(() => { const s = document.querySelectorAll('select')[1]; s.value = 'mojeek'; s.dispatchEvent(new Event('change')); })()`);
    await kosul(() => u.veri.ayarlar.ozelAramaMotoru === 'mojeek', 3000, 'ayarın kaydedilmesi');
    if (u.veri.aramaAdresi('x', 'gizli') !== 'https://www.mojeek.com/search?q=x') throw new Error('gizli arama Mojeek\'e gitmiyor');
    u.veri.ayarla('ozelAramaMotoru', 'brave');
  });

  // --- TurboDownloader video düğmesi (yalnızca /formats çağrılır; gerçek indirme başlatılmaz) ---
  const goruntuKaydet = async (wc, ad) => fs.writeFileSync(path.join(app.getPath('temp'), ad), (await wc.capturePage()).toPNG());
  const dugmeKonumu = (wc) => wc.executeJavaScript(`(() => {
    const h = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
    if (!h || h.style.display === 'none') return null;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top + 14) };
  })()`);
  const videoyaGel = async (wc) => {
    const k = await wc.executeJavaScript(`(() => { const v = document.querySelector('video'); if (!v) return null;
      let r = v.getBoundingClientRect(); if (r.width < 160) r = v.parentElement.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!k) return false;
    for (let i = 0; i < 4; i++) { wc.sendInputEvent({ type: 'mouseMove', x: k.x + i * 5, y: k.y }); await bekle(120); }
    return true;
  };

  await test('TurboDownloader: video üstünde "İndir" düğmesi ve kalite menüsü (normal sekme)', async () => {
    u.veri.ayarla('turboIndir', true);
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    await kosul(() => aktifWc().getURL().includes('youtube.com/watch'), 20000, 'YouTube sayfası');
    const hatalar = [];
    aktifWc().on('console-message', (ayr) => { if (/TrustedHTML|Uncaught/i.test(ayr.message)) hatalar.push(ayr.message.slice(0, 200)); });
    await kosul(async () => videoyaGel(aktifWc()), 25000, 'sayfada video öğesi');
    await kosul(async () => (await dugmeKonumu(aktifWc())) !== null, 5000, '"İndir" düğmesinin görünmesi');
    const k = await dugmeKonumu(aktifWc());
    aktifWc().sendInputEvent({ type: 'mouseMove', x: k.x, y: k.y });
    aktifWc().sendInputEvent({ type: 'mouseDown', x: k.x, y: k.y, button: 'left', clickCount: 1 });
    await bekle(60);
    aktifWc().sendInputEvent({ type: 'mouseUp', x: k.x, y: k.y, button: 'left', clickCount: 1 });
    await bekle(9000); // kalite listesi yt-dlp ile alınır
    await goruntuKaydet(aktifWc(), 'umbra-turbo-menu.png');
    u.veri.ayarla('turboIndir', false);
    if (hatalar.length) throw new Error('sayfa hatası: ' + hatalar[0]);
  });

  await test('TurboDownloader: sahte (site kaynaklı) tıklama indirme başlatamaz', async () => {
    // Site, düğmeyi barındıran öğeye kendi tıklamasını gönderse bile menü açılmamalı
    u.veri.ayarla('turboIndir', true);
    const wc = aktifWc();
    await videoyaGel(wc);
    const sonuc = await wc.executeJavaScript(`(() => {
      const h = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
      if (!h) return 'host yok';
      h.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      return h.shadowRoot === null ? 'kapali' : 'acik-shadow';
    })()`);
    if (sonuc !== 'kapali') throw new Error('shadow DOM kapalı değil ya da düğme yok: ' + sonuc);
    u.veri.ayarla('turboIndir', false);
  });

  await test('TurboDownloader: gizli sekmede video düğmesi yok', async () => {
    u.veri.ayarla('turboIndir', true);
    await tikla('#yeni-gizli');
    await kosul(() => aktifWc().getURL().includes('baslangic.html'), 5000, 'gizli sekme');
    await yazEnter('#q', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', aktifWc());
    await kosul(() => aktifWc().getURL().includes('youtube.com/watch'), 20000, 'YouTube sayfası');
    await kosul(async () => videoyaGel(aktifWc()), 25000, 'sayfada video öğesi');
    await bekle(800);
    if (await dugmeKonumu(aktifWc())) throw new Error('gizli sekmede "İndir" düğmesi göründü');
    await tikla('#sekme-listesi .sekme.aktif .kapat');
    u.veri.ayarla('turboIndir', false);
  });

  // --- Google girişi ---
  await test('Google giriş sayfasında Chrome markası, başka sitede normal kimlik', async () => {
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'https://accounts.google.com/ServiceLogin?hl=tr');
    await kosul(() => aktifWc().getURL().startsWith('https://accounts.google.com/'), 20000, 'Google giriş sayfası');
    await kosul(async () => !aktifWc().isLoading() && (await aktifWc().executeJavaScript('!!document.querySelector("input[type=email], #identifierId, input[name=identifier]")')), 20000, 'e-posta alanı');
    const oku = () => aktifWc().executeJavaScript(`(async () => {
      const uad = navigator.userAgentData;
      const yuksek = await uad.getHighEntropyValues(['fullVersionList']);
      return {
        ua: navigator.userAgent,
        markalar: uad.brands.map((b) => b.brand),
        tamListe: yuksek.fullVersionList.map((b) => b.brand + ' ' + b.version),
        yerlesik: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands').get).includes('[native code]')
          && Function.prototype.toString.call(uad.getHighEntropyValues).includes('[native code]'),
      };
    })()`);
    const google = await oku();
    console.log('GOOGLE KIMLIK', JSON.stringify(google));
    if (!google.markalar.includes('Google Chrome') || !google.tamListe.some((m) => m.startsWith('Google Chrome 1'))) throw new Error('Google sayfasında Chrome markası yok: ' + JSON.stringify(google));
    if (!google.yerlesik) throw new Error('sarmalanan işlevler yerleşik görünmüyor');
    if (google.ua.includes('Electron') || google.ua.includes('Umbra')) throw new Error('kimlikte Electron/Umbra izi var');
    await yazEnter('#adres', 'https://example.com/');
    await adresBekle('example.com', 15000);
    const diger = await oku();
    if (diger.markalar.includes('Google Chrome')) throw new Error('Chrome markası başka sitelere de sızdı');
  });

  // --- Tanı: tarayıcı ortamı ölçümü (yalnızca UMBRA_OLCUM_BETIGI verilirse; Chrome ile karşılaştırma için) ---
  if (process.env.UMBRA_OLCUM_BETIGI) {
    await test('ÖLÇÜM: tarayıcı ortamı', async () => {
      await tikla('#yeni-sekme');
      const adres = process.env.UMBRA_OLCUM_ADRES || 'https://example.com/';
      await yazEnter('#adres', adres);
      await kosul(() => aktifWc().getURL().startsWith(adres.slice(0, 24)) && !aktifWc().isLoading(), 20000, 'yükleme');
      await bekle(1500);
      const betik = fs.readFileSync(process.env.UMBRA_OLCUM_BETIGI, 'utf8');
      const sonuc = await aktifWc().executeJavaScript(`${betik}; window.__olc`);
      fs.writeFileSync(process.env.UMBRA_OLCUM_BETIGI.replace(/\.js$/, '-umbra.json'), JSON.stringify(sonuc));
    });
  }

  // --- Rapor ---
  const kalan = sonuclar.filter((s) => s.durum === 'KALDI');
  const rapor = sonuclar.map((s) => `${s.durum === 'GEÇTİ' ? '✓' : '✗'} ${s.ad}${s.hata ? '  →  ' + s.hata : ''}`).join('\n')
    + `\n\n${sonuclar.length - kalan.length}/${sonuclar.length} test geçti`;
  console.log(rapor);
  fs.writeFileSync(path.join(app.getPath('temp'), 'umbra-arayuz-testi.txt'), rapor);
  app.exit(kalan.length ? 1 : 0);
};
