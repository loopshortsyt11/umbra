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
  // Bir söz, en fazla ms kadar beklenir (kapanmış bir sayfaya yapılan çağrılar hiç dönmeyebilir)
  const sinirla = (soz, ms, aciklama) => Promise.race([soz, bekle(ms).then(() => { throw new Error(aciklama + " " + ms + " ms içinde bitmedi"); })]);

  // Hata anında sekmelerin ve sekme çubuğunun durumunu yazdırır (UMBRA_TEST_TANI=1 ile)
  async function tani(ad) {
    try {
      const sekmeler = [...u.sekmeler.values()].map((x) => `${x.id}:${x.tur}:${u.sekmeAdresi(x).slice(0, 40)}`
        + (x.onceki ? "<" + x.onceki.id : "") + (x.sonraki ? ">" + x.sonraki.id : ""));
      const dom = await sinirla(ui().executeJavaScript("[...document.querySelectorAll('#sekme-listesi .sekme')].map((e) => e.className + '|' + e.textContent.slice(0, 25))"), 3000, "sekme çubuğu");
      console.log("TANI", ad, JSON.stringify({ aktif: u.aktifSekme()?.id ?? null, sekmeler, dom }));
      const g = u.aktifSekme()?.view.webContents;
      if (g && !g.isDestroyed()) fs.writeFileSync(path.join(app.getPath("temp"), "umbra-tani-" + sonuclar.length + ".png"), (await sinirla(g.capturePage(), 3000, "görüntü")).toPNG());
    } catch (x) {
      console.log("TANI-HATA", ad, x.message);
    }
  }

  // Yeni sekme sayfasındaki kutuya yazılan metin adres çubuğuna aktarılır (Chrome gibi); Enter orada basılır
  async function yeniSekmeKutusunaYaz(metin) {
    await tikla('.arama-kutusu input', { wc: aktifWc() });
    await aktifWc().insertText(metin);
    await kosul(async () => (await ui().executeJavaScript('document.getElementById("adres").value')).startsWith(metin), 3000, 'yazının adres çubuğuna aktarılması');
    await bekle(150);
    // satır içi tamamlama eklendiyse yazılanla sınırlı kalsın
    await ui().executeJavaScript(`(() => { const a = document.getElementById("adres"); a.value = ${JSON.stringify(metin)}; })()`);
    ui().sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    ui().sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) });
    ui().sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await bekle(300);
  }

  // anahtarsiz: AI anahtarının olmadığı durumu sınayan test; UMBRA_TEST_ANAHTAR_KLASORU verilmişse atlanır
  async function test(ad, fn, { anahtarsiz = false } = {}) {
    if (filtre && !new RegExp(filtre).test(ad)) return;
    if (anahtarsiz && process.env.UMBRA_TEST_ANAHTAR_KLASORU) { sonuclar.push({ durum: "ATLANDI", ad }); return; }
    const t0 = Date.now();
    try {
      await sinirla(fn(), 180000, "test");
      sonuclar.push({ durum: "GEÇTİ", ad });
      console.log(`✓ ${ad} (${Math.round((Date.now() - t0) / 1000)} sn)`);
    } catch (h) {
      if (process.env.UMBRA_TEST_TANI) await tani(ad);
      sonuclar.push({ durum: "KALDI", ad, hata: h.message });
      console.log(`✗ ${ad}  →  ${h.message}`);
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

  // --- Yer işaretleri: yıldız penceresi ve adres çubuğunun altındaki çubuk (Chrome gibi) ---
  const ypAcik = async () => !(await ui().executeJavaScript('document.getElementById("yerimi-pencere").hidden'));
  const cubuktakiIdler = () => ui().executeJavaScript('[...document.querySelectorAll("#cubuk-ogeler .cubuk-oge")].map((b) => Number(b.dataset.id))');
  const yerIminiTemizle = (url) => { const y = u.veri.yerImiBul(url); if (y) u.veri.yerImiSil(y.id); };

  await test('Yıldız: pencere açılır, klasör sorar, çubukta görünür, Kaldır siler', async () => {
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    const url = u.sekmeAdresi(u.aktifSekme());
    yerIminiTemizle(url);
    await tikla('#yildiz');
    await kosul(() => u.veri.yerImiMi(url), 3000, 'yer iminin eklenmesi');
    await kosul(ypAcik, 3000, 'yıldız penceresinin açılması');
    const baslik = await ui().executeJavaScript('document.getElementById("yp-baslik").textContent');
    if (baslik !== 'Yer işareti eklendi') throw new Error('pencere başlığı: ' + baslik);
    const klasorler = await ui().executeJavaScript('[...document.querySelectorAll("#yp-klasor option")].map((o) => o.value)');
    if (!klasorler.includes('cubuk') || !klasorler.includes('diger')) throw new Error('klasör seçenekleri eksik: ' + klasorler);
    const id = u.veri.yerImiBul(url).id;
    await kosul(async () => (await cubuktakiIdler()).includes(id), 3000, 'yer iminin çubukta görünmesi');
    await tikla('#yp-kaldir');
    await kosul(() => !u.veri.yerImiMi(url), 3000, 'yer iminin kaldırılması');
    await kosul(async () => !(await ypAcik()), 2000, 'pencerenin kapanması');
    await kosul(async () => !(await cubuktakiIdler()).includes(id), 3000, 'yer iminin çubuktan çıkması');
  });

  await test('Yıldız penceresi: ad ve "Diğer yer işaretleri" klasörü kaydedilir', async () => {
    const url = u.sekmeAdresi(u.aktifSekme());
    yerIminiTemizle(url);
    await tikla('#yildiz');
    await kosul(ypAcik, 3000, 'yıldız penceresinin açılması');
    await ui().executeJavaScript('document.getElementById("yp-ad").select()');
    await ui().insertText('Test Adı');
    await ui().executeJavaScript('(() => { const s = document.getElementById("yp-klasor"); s.value = "diger"; s.dispatchEvent(new Event("change")); })()');
    await tikla('#yp-bitti');
    await kosul(() => { const y = u.veri.yerImiBul(url); return y && y.baslik === 'Test Adı' && u.veri.klasoru(y) === 'diger'; }, 3000, 'ad ve klasörün kaydedilmesi');
    const id = u.veri.yerImiBul(url).id;
    await bekle(300);
    if ((await cubuktakiIdler()).includes(id)) throw new Error('"Diğer" klasöründeki yer imi çubukta göründü');
    // yeniden yıldıza basınca düzenleme penceresi açılır, yer imi silinmez
    await tikla('#yildiz');
    await kosul(ypAcik, 3000, 'düzenleme penceresi');
    const baslik = await ui().executeJavaScript('document.getElementById("yp-baslik").textContent');
    if (baslik !== 'Yer işaretini düzenle') throw new Error('pencere başlığı: ' + baslik);
    ui().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    ui().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await kosul(async () => !(await ypAcik()), 2000, 'Esc ile kapanma');
    if (!u.veri.yerImiMi(url)) throw new Error('Esc yer imini sildi');
    yerIminiTemizle(url);
  });

  // --- Hız ölçümü (yalnızca UMBRA_HIZ=1 ile): ağır sitelerin önbelleksiz açılış süreleri ve ana süreç gecikmesi ---
  if (process.env.UMBRA_HIZ) {
    await test('Hız ölçümü', async () => {
      const siteler = ['https://www.hurriyet.com.tr/', 'https://www.trendyol.com/', 'https://www.youtube.com/', 'https://tr.wikipedia.org/wiki/T%C3%BCrkiye', 'https://www.sahibinden.com/'];
      // Ana süreç ne kadar meşgul: 10 ms'lik zamanlayıcının gecikmesi
      let enBuyukGecikme = 0, toplamGecikme = 0, olcum = 0, son = Date.now();
      const gecikmeOlcer = setInterval(() => { const g = Date.now() - son - 10; son = Date.now(); if (g > 0) { toplamGecikme += g; enBuyukGecikme = Math.max(enBuyukGecikme, g); } olcum++; }, 10);
      const sonuc = [];
      for (const site of siteler) {
        const sureler = [];
        for (let i = 0; i < 3; i++) {
          await aktifWc().session.clearCache();
          const t0 = Date.now();
          const bitti = new Promise((r) => aktifWc().once('did-stop-loading', r));
          aktifWc().loadURL(site);
          await Promise.race([bitti, bekle(30000)]);
          const nav = await aktifWc().executeJavaScript(`(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? [Math.round(n.domContentLoadedEventEnd), Math.round(n.loadEventEnd), performance.getEntriesByType('resource').length] : null; })()`).catch(() => null);
          sureler.push({ toplam: Date.now() - t0, dcl: nav?.[0], yuk: nav?.[1], istek: nav?.[2] });
        }
        const ort = (k) => Math.round(sureler.reduce((t, s) => t + (s[k] || 0), 0) / sureler.length);
        sonuc.push(`${new URL(site).hostname}: DCL ${ort('dcl')} ms, load ${ort('yuk')} ms, durma ${ort('toplam')} ms, ${ort('istek')} istek`);
      }
      clearInterval(gecikmeOlcer);
      console.log('HIZ\n  ' + sonuc.join('\n  ') + `\n  ana süreç gecikmesi: ort ${(toplamGecikme / olcum).toFixed(2)} ms, en büyük ${enBuyukGecikme} ms`);
    });
  }

  // --- Dolandırıcılık ve zararlı yazılım koruması (test için listeye sahte bir kayıt eklenir) ---
  const uyariMetni = () => aktifWc().executeJavaScript('document.body ? document.body.innerText : ""').catch(() => '');
  await test('Dolandırıcılık sitesi açılmaz, uyarı gösterilir; "Güvenli sayfaya dön" geri götürür', async () => {
    u.guvenlik.alanlar.set('example.org', 'oltalama');
    await yazEnter('#adres', 'example.com');
    await adresBekle('example.com', 15000);
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    await yazEnter('#adres', 'example.org');
    await kosul(async () => aktifWc().getURL().startsWith('data:') && (await uyariMetni()).includes('dolandırıcılık'), 10000, 'uyarı sayfası');
    if (!u.sekmeAdresi(u.aktifSekme()).includes('example.org')) throw new Error('adres çubuğu tehlikeli adresi göstermiyor');
    await tikla('button.geri', { wc: aktifWc() });
    await kosul(() => /^https:\/\/example\.com\//.test(aktifWc().getURL()), 10000, 'önceki sayfaya dönüş');
  });

  await test('Uyarıda "riski göze alıp siteye git" siteyi açar', async () => {
    await yazEnter('#adres', 'example.org');
    await kosul(async () => aktifWc().getURL().startsWith('data:') && (await uyariMetni()).includes('dolandırıcılık'), 10000, 'uyarı sayfası');
    await aktifWc().executeJavaScript('document.querySelector("details").open = true');
    await tikla('details a', { wc: aktifWc() });
    await kosul(() => /^https:\/\/example\.org\//.test(aktifWc().getURL()), 15000, 'sitenin açılması');
    u.guvenlik.alanlar.delete('example.org');
  });

  // Google/Apple ile giriş: site küçük bir pencere açar ve sonucu window.opener ile geri alır (claude.ai gibi)
  await test('Giriş penceresi açılır pencere olarak açılır ve açan sayfayla haberleşir', async () => {
    const { BrowserWindow } = require('electron');
    if (!/^https:\/\/example\.com/.test(u.sekmeAdresi(u.aktifSekme()))) {
      await yazEnter('#adres', 'example.com');
      await adresBekle('example.com', 15000);
    }
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    const sekmeSayisi = u.sekmeler.size;
    const once = BrowserWindow.getAllWindows().length;
    await aktifWc().executeJavaScript(`window.__mesaj = null; window.addEventListener('message', (e) => { window.__mesaj = e.data; });
      window.__giris = window.open('https://example.com/?giris', 'giris', 'width=480,height=600'); true`, true);
    await kosul(() => BrowserWindow.getAllWindows().length === once + 1, 5000, 'açılır pencerenin açılması');
    if (u.sekmeler.size !== sekmeSayisi) throw new Error('giriş penceresi sekmeye çevrildi');
    const acilir = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('giris') || w.webContents.isLoading());
    await kosul(() => acilir.webContents.getURL().includes('giris') && !acilir.webContents.isLoading(), 15000, 'giriş sayfasının yüklenmesi');
    if (acilir.webContents.session !== aktifWc().session) throw new Error('açılır pencere farklı oturumda');
    await acilir.webContents.executeJavaScript(`window.opener.postMessage('giris-tamam', '*'); true`);
    await kosul(async () => (await aktifWc().executeJavaScript('window.__mesaj')) === 'giris-tamam', 3000, 'açan sayfanın mesajı alması');
    // Google giriş düzeltmesi ("Bu tarayıcı güvenli olmayabilir") açılır pencerede de geçerli olmalı
    await acilir.webContents.loadURL('https://accounts.google.com/');
    const marka = await acilir.webContents.executeJavaScript(
      `(navigator.userAgentData?.brands || []).some((b) => b.brand === 'Google Chrome') && typeof window.chrome?.loadTimes === 'function'`);
    if (!marka) throw new Error('açılır pencerede Google giriş düzeltmesi yok');
    acilir.close();
    await kosul(() => BrowserWindow.getAllWindows().length === once, 3000, 'pencerenin kapanması');
  });

  await test('Yer işareti çubuğundaki öğeye tıklayınca site açılır', async () => {
    const hedef = 'https://example.com/';
    yerIminiTemizle(hedef);
    await yazEnter('#adres', 'example.com');
    await adresBekle('example.com', 15000);
    await kosul(() => !aktifWc().isLoading(), 15000, 'yüklemenin bitmesi');
    await tikla('#yildiz');
    await kosul(ypAcik, 3000, 'yıldız penceresi');
    await tikla('#yp-bitti');
    const id = u.veri.yerImiBul(hedef).id;
    await tikla('#ana');
    await adresBekle('umbra://ara', 5000);
    await kosul(async () => (await cubuktakiIdler()).includes(id), 3000, 'çubukta görünmesi');
    await tikla(`#cubuk-ogeler .cubuk-oge[data-id="${id}"]`);
    await adresBekle('example.com', 15000);
    yerIminiTemizle(hedef);
  });

  await test('Yeni sekmede imleç adres çubuğunda; sayfada yalnızca kısayollar var', async () => {
    u.veri.yerImiEkle('https://example.org/', 'Örnek Yer İmi');
    await tikla('#yeni-sekme');
    await kosul(async () => !aktifWc().isLoading() && (await konum('.kutucuklar', aktifWc())) !== null, 5000, 'yeni sekme sayfası');
    await bekle(400);
    const odak = await ui().executeJavaScript('document.hasFocus() && document.activeElement && document.activeElement.id');
    if (odak !== 'adres') throw new Error('odak adres çubuğunda değil: ' + odak);
    const sayfaOdak = await aktifWc().executeJavaScript('document.activeElement && document.activeElement.tagName');
    if (sayfaOdak === 'INPUT') throw new Error('sayfadaki arama kutusu odağı aldı');
    const adlar = await aktifWc().executeJavaScript('[...document.querySelectorAll(".kutucuk .ad")].map((e) => e.textContent)');
    if (adlar.includes('Örnek Yer İmi')) throw new Error('yer imi kısayollarda göründü');
    yerIminiTemizle('https://example.org/');
  });

  await test('Yeni sekme: kısayol ekle ve kaldır', async () => {
    await kosul(async () => (await konum('.kutucuk.ekle', aktifWc())) !== null, 5000, '"Kısayol ekle" kutucuğu');
    await tikla('.kutucuk.ekle', { wc: aktifWc() });
    await kosul(async () => (await konum('.kisayol-formu input', aktifWc())) !== null, 3000, 'kısayol formu');
    await aktifWc().executeJavaScript('document.querySelector(".kisayol-formu input").focus()');
    await aktifWc().insertText('Vikipedi');
    await aktifWc().executeJavaScript('document.querySelectorAll(".kisayol-formu input")[1].focus()');
    await aktifWc().insertText('tr.wikipedia.org');
    await tikla('.kisayol-formu button.birincil', { wc: aktifWc() });
    await kosul(() => u.veri.kisayollar().some((k) => k.ad === 'Vikipedi' && k.url.includes('wikipedia.org')), 3000, 'kısayolun kaydedilmesi');
    await kosul(async () => (await aktifWc().executeJavaScript('[...document.querySelectorAll(".kutucuk .ad")].map((e) => e.textContent)')).includes('Vikipedi'), 3000, 'kutucuğun görünmesi');
    await aktifWc().executeJavaScript('[...document.querySelectorAll(".kutucuk")].find((k) => k.textContent.includes("Vikipedi")).querySelector(".kisayol-sil").click()');
    await kosul(() => !u.veri.kisayollar().some((k) => k.ad === 'Vikipedi'), 3000, 'kısayolun kaldırılması');
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
    await yeniSekmeKutusunaYaz('example.net');
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
    const once = u.veri.ayarlar.izleyiciEngelle;
    await kosul(async () => (await konum('.anahtar span', aktifWc())) !== null, 3000, 'anahtarın çizilmesi');
    await tikla('.anahtar span', { wc: aktifWc() });
    await kosul(() => u.veri.ayarlar.izleyiciEngelle === !once, 3000, 'ayarın değişmesi');
    await tikla('.anahtar span', { wc: aktifWc() });
    await kosul(() => u.veri.ayarlar.izleyiciEngelle === once, 3000, 'ayarın geri dönmesi');
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
  }, { anahtarsiz: true });

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
  }, { anahtarsiz: true });

  await test('Ayarlar: gizli/Tor arama motoru seçimi', async () => {
    await yazEnter('#adres', 'umbra://ayarlar');
    await adresBekle('umbra://ayarlar', 5000);
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll("select").length')) >= 2, 8000, 'arama motoru seçimleri');
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

  // --- Adres çubuğu: tek kelimeyle siteye gitme ---
  await test('Adres çubuğu: "youtube" yazınca youtube.com açılır, "?youtube" arar', async () => {
    await tikla('#yeni-sekme');
    await kosul(async () => !aktifWc().isLoading() && (await konum('.arama-kutusu input', aktifWc())) !== null, 5000, 'yeni sekme sayfası');
    await bekle(400);
    await tikla('#adres');
    // ilk tıklama tüm adresi seçmeli; yazılan metin eski adresin yerine geçmeli
    await ui().insertText('youtube');
    const deger = await ui().executeJavaScript('document.getElementById("adres").value');
    if (deger !== 'youtube') throw new Error('adres çubuğuna tıklayınca eski adres seçilmedi, yazı eklendi: ' + deger);
    await kosul(async () => (await ui().executeJavaScript('document.querySelector("#oneriler .oneri .tur")?.textContent')) === '🌐', 3000, 'ilk önerinin 🌐 site olması');
    ui().sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    ui().sendInputEvent({ type: 'char', keyCode: '\r' });
    ui().sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await kosul(() => /^https:\/\/(www\.)?youtube\.com\//.test(u.sekmeAdresi(u.aktifSekme())), 20000, 'youtube.com');
    await yazEnter('#adres', '?youtube');
    await kosul(() => !/youtube\.com/.test(u.sekmeAdresi(u.aktifSekme())), 10000, 'arama sayfası');
    const adres = u.sekmeAdresi(u.aktifSekme());
    if (!/search|umbra:\/\/ara/.test(adres) || !adres.includes('youtube')) throw new Error('"?youtube" aranmadı: ' + adres);
    if (u.veri.siteTahmini('merhaba') !== null) throw new Error('bilinmeyen kelime siteye çevrildi');
  });

  // --- Geri/ileri: yeni sekme sayfası ile web sayfası arasında ---
  await test('Yeni sekmeden siteye git; geri yeni sekme sayfasına, ileri siteye döner', async () => {
    if (u.veri.ayarlar.acilis !== 'yeni-sekme') throw new Error('varsayılan açılış yeni sekme değil: ' + u.veri.ayarlar.acilis);
    await tikla('#yeni-sekme');
    await kosul(async () => !aktifWc().isLoading() && (await konum('.arama-kutusu input', aktifWc())) !== null, 5000, 'yeni sekme sayfası');
    const n = u.sekmeler.size;
    await yeniSekmeKutusunaYaz('example.com');
    await adresBekle('example.com', 15000);
    if (u.sekmeler.size !== n) throw new Error('sekme sayısı değişti');
    await kosul(async () => !(await ui().executeJavaScript('document.getElementById("geri").disabled')), 3000, 'geri düğmesinin etkin olması');
    await tikla('#geri');
    await adresBekle('umbra://ara', 5000);
    await kosul(async () => (await konum('.arama-kutusu input', aktifWc())) !== null, 3000, 'yeni sekme sayfasının geri gelmesi');
    await tikla('#ileri');
    await adresBekle('example.com', 5000);
    // Geri dönüp başka yere gidince "ileri" silinmeli
    await tikla('#geri');
    await adresBekle('umbra://ara', 5000);
    await yazEnter('#adres', 'umbra://gecmis');
    await adresBekle('umbra://gecmis', 5000);
    await kosul(async () => (await ui().executeJavaScript('document.getElementById("ileri").disabled')), 3000, 'ileri geçmişinin silinmesi');
  });

  await test('Arama sayfası: Görseller/Videolar/... sekmeleri ve Araçlar zaman filtresi', async () => {
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'umbra://ara?q=kedi');
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".dikeyler a.dikey").length')) >= 10, 8000, 'arama sekmeleri');
    const adlar = await aktifWc().executeJavaScript('[...document.querySelectorAll(".dikeyler a.dikey")].map((a) => a.textContent)');
    for (const ad of ['AI Modu', 'Tümü', 'Görseller', 'Videolar', 'Kısa videolar', 'Alışveriş', 'Haberler', 'Yerler', 'Daha fazla', 'Araçlar']) {
      if (!adlar.some((x) => x.includes(ad))) throw new Error(`"${ad}" sekmesi yok: ` + adlar.join(', '));
    }
    await goruntuKaydet(aktifWc(), 'umbra-arama-sekmeleri.png');
    const gorsel = await aktifWc().executeJavaScript('[...document.querySelectorAll(".dikeyler a.dikey")].findIndex((a) => a.textContent === "Görseller") + 1');
    await tikla(`.dikeyler a.dikey:nth-of-type(${gorsel})`, { wc: aktifWc() });
    await adresBekle('mod=gorsel', 5000);
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".gorsel-kutu img").length')) > 5, 20000, 'görsel sonuçları');
    if (/brave|bing|duckduckgo/i.test(u.sekmeAdresi(u.aktifSekme()))) throw new Error('adres çubuğunda başka arama motoru görünüyor');
    await tikla('#geri');
    await adresBekle('umbra://ara?q=kedi', 5000);
    // Araçlar → Son 1 hafta
    await kosul(async () => (await konum('.dikeyler .acilir:last-child a.dikey', aktifWc())) !== null, 8000, 'Araçlar düğmesi');
    await tikla('.dikeyler .acilir:last-child a.dikey', { wc: aktifWc() });
    const hafta = await aktifWc().executeJavaScript('[...document.querySelectorAll(".dikeyler .acilir:last-child a.acilir-oge")].findIndex((a) => a.textContent === "Son 1 hafta") + 1');
    await tikla(`.dikeyler .acilir:last-child a.acilir-oge:nth-of-type(${hafta})`, { wc: aktifWc() });
    await adresBekle('zaman=hafta', 5000);
  });

  await test('Tümü: arama Umbra sayfasında klasik web sonuçlarıyla açılır, sonuca tıklayınca site açılır', async () => {
    await tikla('#yeni-sekme');
    await yazEnter('#adres', 'umbra://ara?q=' + encodeURIComponent('istanbul boğazı'));
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".web-sonuc").length')) >= 5, 20000, 'web sonuçları');
    await bekle(600);
    await goruntuKaydet(aktifWc(), 'umbra-tumu.png');
    const ilk = await aktifWc().executeJavaScript('document.querySelector(".web-sonuc a.web-baslik").title');
    if (!/^https:\/\//.test(ilk) || /bing\.com|duckduckgo\.com/.test(ilk)) throw new Error('sonuç bağlantısı doğrudan siteye gitmiyor: ' + ilk);
    const aktifSekmeAdi = await aktifWc().executeJavaScript('document.querySelector(".dikeyler a.dikey.aktif").textContent');
    if (aktifSekmeAdi !== 'Tümü') throw new Error('varsayılan sekme Tümü değil: ' + aktifSekmeAdi);
    await tikla('.web-sonuc a.web-baslik', { wc: aktifWc() });
    await kosul(() => u.sekmeAdresi(u.aktifSekme()).startsWith('https://'), 15000, 'sitenin açılması');
    await tikla('#geri');
    await adresBekle('umbra://ara?q=', 5000);
  });

  await test('Görseller: önizleme açılır, Esc ile kapanır; Videolar ve Haberler sonuç verir', async () => {
    await yazEnter('#adres', 'umbra://ara?mod=gorsel&q=kedi');
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".gorsel-kutu").length')) > 5, 20000, 'görseller');
    await bekle(1500);
    await goruntuKaydet(aktifWc(), 'umbra-gorseller.png');
    await tikla('.gorsel-kutu', { wc: aktifWc() });
    await kosul(async () => aktifWc().executeJavaScript('!!document.querySelector(".onizleme")'), 3000, 'önizleme');
    await bekle(1200);
    await goruntuKaydet(aktifWc(), 'umbra-onizleme.png');
    aktifWc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    aktifWc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await kosul(async () => aktifWc().executeJavaScript('!document.querySelector(".onizleme")'), 3000, 'önizlemenin kapanması');
    await yazEnter('#adres', 'umbra://ara?mod=video&q=kedi');
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".video-sonuc").length')) > 3, 20000, 'videolar');
    await yazEnter('#adres', 'umbra://ara?mod=haber&q=' + encodeURIComponent('istanbul'));
    await kosul(async () => (await aktifWc().executeJavaScript('document.querySelectorAll(".haber-sonuc").length')) > 2, 20000, 'haberler');
  });

  await test('Adres çubuğu: "wiki" yazınca "wikipedia" olarak tamamlanır ve Vikipedi açılır', async () => {
    await tikla('#yeni-sekme');
    await kosul(async () => !aktifWc().isLoading() && (await konum('.arama-kutusu input', aktifWc())) !== null, 5000, 'yeni sekme sayfası');
    await bekle(400);
    await tikla('#adres');
    await ui().insertText('wiki');
    await kosul(async () => (await ui().executeJavaScript('document.getElementById("adres").value')) === 'wikipedia', 3000, 'satır içi tamamlama');
    const secim = await ui().executeJavaScript('[document.getElementById("adres").selectionStart, document.getElementById("adres").selectionEnd]');
    if (secim[0] !== 4 || secim[1] !== 9) throw new Error('tamamlanan kısım seçili değil: ' + secim);
    const ilkOneri = await ui().executeJavaScript('document.querySelector("#oneriler .oneri")?.innerText || ""');
    if (!ilkOneri.includes('wikipedia')) throw new Error('ilk öneri Vikipedi değil: ' + ilkOneri);
    ui().sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    ui().sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) });
    ui().sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await adresBekle('wikipedia.org', 15000);
  });

  await test('Arkada saklanan sayfa adresini değiştirince görünen sekme kapanmaz', async () => {
    // yeni sekme (A) → web (B, A arkada) → umbra://gecmis (C, B arkada); sonra B kendi adresini pushState ile değiştirir
    await tikla('#yeni-sekme');
    await kosul(async () => !aktifWc().isLoading() && (await konum('.arama-kutusu input', aktifWc())) !== null, 5000, 'yeni sekme sayfası');
    await yeniSekmeKutusunaYaz('example.com');
    await adresBekle('example.com', 15000);
    await kosul(() => !aktifWc().isLoading(), 15000, 'yükleme');
    await yazEnter('#adres', 'umbra://gecmis');
    await adresBekle('umbra://gecmis', 5000);
    const gorunen = u.aktifSekme();
    const sakli = gorunen.onceki;
    if (!sakli) throw new Error('web sayfası arkada saklanmadı');
    await sakli.view.webContents.executeJavaScript('history.pushState({}, "", "/arka-plan-degisikligi")');
    await bekle(800);
    if (u.aktifSekme() !== gorunen || gorunen.view.webContents.isDestroyed()) throw new Error('görünen sekme kapatıldı');
    await tikla('#geri');
    await kosul(() => u.sekmeAdresi(u.aktifSekme()).includes('example.com'), 5000, 'geri ile web sayfasına dönüş');
  });

  if (process.env.UMBRA_TEST_ANAHTAR_KLASORU) {
    await test('Umbra Arama: web sonuçları yanıttan önce görünür, aşama ve süre ilerler (ücretli)', async () => {
      await tikla('#yeni-sekme');
      await yazEnter('#adres', 'umbra://ara?mod=ai&q=' + encodeURIComponent('istanbul yarın hava durumu'));
      await kosul(async () => (await konum('.yanit-durum', aktifWc())) !== null, 5000, 'arama sayfası');
      let onceSonuc = false, sureIlerledi = false, asamalar = new Set();
      const bitis = Date.now() + 90000;
      while (Date.now() < bitis) {
        const d = await aktifWc().executeJavaScript(`({ sonuc: document.querySelectorAll('.sonuc').length,
          yanit: (document.querySelector('.yanit-metni')?.innerText || '').trim().length,
          durum: document.querySelector('.yanit-durum')?.innerText || '', gizli: document.querySelector('.yanit-durum')?.hidden })`);
        if (d.sonuc > 0 && d.yanit === 0) onceSonuc = true;
        if (/\d+ sn/.test(d.durum) && !/· 0 sn/.test(d.durum)) sureIlerledi = true;
        if (d.durum) asamalar.add(d.durum.replace(/ · \d+ sn/, ''));
        if (d.yanit > 40 && d.gizli && !(await aktifWc().executeJavaScript('document.querySelector(".yanit-metni").classList.contains("yaziyor")'))) break;
        await bekle(400);
      }
      console.log('ARAMA ASAMALARI', JSON.stringify([...asamalar]));
      if (!onceSonuc) throw new Error('web sonuçları yanıttan önce görünmedi');
      if (!sureIlerledi) throw new Error('geçen süre gösterilmedi');
      if (!(await aktifWc().executeJavaScript('document.querySelector(".yanit-metni").innerText.length > 40'))) throw new Error('yanıt gelmedi');
    });
  }

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

  // Görsel denetim için pencere açık bırakılabilir (UMBRA_TEST_BEKLE=milisaniye)
  if (process.env.UMBRA_TEST_BEKLE) {
    u.pencere.setAlwaysOnTop(true); // denetim sırasında başka pencereler örtmesin
    u.pencere.focus();
    await bekle(Number(process.env.UMBRA_TEST_BEKLE));
  }

  // --- Rapor ---
  const kalan = sonuclar.filter((s) => s.durum === 'KALDI');
  const atlanan = sonuclar.filter((s) => s.durum === 'ATLANDI').length;
  const rapor = sonuclar.map((s) => `${{ 'GEÇTİ': '✓', KALDI: '✗', ATLANDI: '–' }[s.durum]} ${s.ad}${s.hata ? '  →  ' + s.hata : ''}`).join('\n')
    + `\n\n${sonuclar.length - kalan.length - atlanan}/${sonuclar.length - atlanan} test geçti${atlanan ? ` (${atlanan} atlandı)` : ''}`;
  console.log(rapor);
  fs.writeFileSync(path.join(app.getPath('temp'), 'umbra-arayuz-testi.txt'), rapor);
  app.exit(kalan.length ? 1 : 0);
};
