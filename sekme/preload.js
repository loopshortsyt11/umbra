// Normal sekmelerde videoların üstüne "İndir ▼" düğmesi koyar (TurboDownloader kalite menüsü).
// TurboDownloader eklentisinin content.js dosyasından uyarlanmıştır. Güvenlik:
//  - Yalnızca normal sekmelere yüklenir; gizli/Tor sekmelerinde ve Umbra'nın kendi sayfalarında yoktur.
//  - Sayfaya hiçbir işlev açılmaz (contextBridge kullanılmaz); düğme kapalı shadow DOM içindedir.
//  - Yalnızca gerçek kullanıcı tıklamaları (isTrusted) işlenir: site düğmeye kendisi "tıklayıp" indirme başlatamaz.
//  - Sayfa adresini ana süreç kendisi belirler; buradan gelen bilgiye güvenmez.
const { ipcRenderer, contextBridge } = require('electron');

// Google giriş sayfasında navigator.userAgentData marka listesine "Google Chrome" eklenir (ana süreç aynısını
// sec-ch-ua başlıklarında yapar). Yerleşik işlevler Proxy ile sarılır; böylece sayfaya yerleşik kod gibi görünürler.
if (location.hostname === 'accounts.google.com') {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const P = window.NavigatorUAData && NavigatorUAData.prototype;
        if (!P) return;
        const chromeEkle = (liste, surumAlani) => {
          if (!Array.isArray(liste) || liste.some((b) => b.brand === 'Google Chrome')) return liste;
          const krom = liste.find((b) => b.brand === 'Chromium');
          return krom ? [{ brand: 'Google Chrome', [surumAlani]: krom[surumAlani] }, ...liste] : liste;
        };
        const markalar = Object.getOwnPropertyDescriptor(P, 'brands');
        Object.defineProperty(P, 'brands', {
          ...markalar,
          get: new Proxy(markalar.get, { apply: (h, bu, a) => chromeEkle(Reflect.apply(h, bu, a), 'version') }),
        });
        const yuksek = P.getHighEntropyValues;
        P.getHighEntropyValues = new Proxy(yuksek, {
          apply: (h, bu, a) => Reflect.apply(h, bu, a).then((d) => ({
            ...d,
            ...(d.brands ? { brands: chromeEkle(d.brands, 'version') } : {}),
            ...(d.fullVersionList ? { fullVersionList: chromeEkle(d.fullVersionList, 'version') } : {}),
          })),
        });
        const json = P.toJSON;
        if (json) P.toJSON = new Proxy(json, { apply: (h, bu, a) => ({ ...Reflect.apply(h, bu, a), brands: chromeEkle(Reflect.apply(h, bu, a).brands, 'version') }) });

        // Gerçek Chrome'da her sayfada bulunan chrome.app / chrome.csi / chrome.loadTimes Electron'da yoktur.
        // bind() ile üretilen işlevler toString'de "[native code]" verir, yerleşik işlevlerden ayırt edilmez.
        const yerlesik = (f) => f.bind(null);
        const zaman = performance.timing;
        const krom = window.chrome || {};
        if (!krom.app) {
          krom.app = {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            getDetails: yerlesik(() => null),
            getIsInstalled: yerlesik(() => false),
            installState: yerlesik((cb) => { if (typeof cb === 'function') setTimeout(() => cb('not_installed'), 0); }),
            runningState: yerlesik(() => 'cannot_run'),
          };
        }
        if (!krom.csi) {
          krom.csi = yerlesik(() => ({
            startE: zaman.navigationStart, onloadT: zaman.domContentLoadedEventEnd, pageT: performance.now(), tran: 15,
          }));
        }
        if (!krom.loadTimes) {
          krom.loadTimes = yerlesik(() => {
            const n = performance.getEntriesByType('navigation')[0] || {};
            const sn = (ms) => ms / 1000;
            const boya = performance.getEntriesByType('paint').find((p) => p.name === 'first-paint');
            return {
              requestTime: sn(zaman.requestStart), startLoadTime: sn(zaman.navigationStart), commitLoadTime: sn(zaman.responseStart),
              finishDocumentLoadTime: sn(zaman.domContentLoadedEventEnd), finishLoadTime: sn(zaman.loadEventEnd),
              firstPaintTime: boya ? sn(zaman.navigationStart + boya.startTime) : 0, firstPaintAfterLoadTime: 0,
              navigationType: 'Other', wasFetchedViaSpdy: n.nextHopProtocol === 'h2' || n.nextHopProtocol === 'h3',
              wasNpnNegotiated: Boolean(n.nextHopProtocol), npnNegotiatedProtocol: n.nextHopProtocol || 'unknown',
              wasAlternateProtocolAvailable: false, connectionInfo: n.nextHopProtocol || 'http/1.1',
            };
          });
        }
        if (!window.chrome) Object.defineProperty(window, 'chrome', { value: krom, writable: true, configurable: true, enumerable: true });

        // Dil listesi gerçek Chrome'daki gibi (Electron yalnızca uygulama dilini verir)
        const N = Navigator.prototype;
        const getirSar = (nesne, ad, deger) => {
          const t = Object.getOwnPropertyDescriptor(nesne, ad);
          if (t && t.get) Object.defineProperty(nesne, ad, { ...t, get: new Proxy(t.get, { apply: () => deger() }) });
        };
        const diller = Object.freeze(['tr-TR', 'tr', 'en-US', 'en']);
        getirSar(N, 'languages', () => diller);
        getirSar(N, 'language', () => 'tr-TR');

        // Bildirim izni sorulmamış görünsün ("default"); Umbra bu izni zaten ilk istekte kullanıcıya sorar
        if (window.Notification) getirSar(Notification, 'permission', () => 'default');
        const sorgu = Permissions.prototype.query;
        Permissions.prototype.query = new Proxy(sorgu, {
          apply: (h, bu, a) => Reflect.apply(h, bu, a).then((d) => (a[0] && a[0].name === 'notifications' && d.state === 'denied'
            ? new Proxy(d, { get: (o, k) => (k === 'state' ? 'prompt' : Reflect.get(o, k, o)) })
            : d)),
        });

        // Web Paylaşım (Chrome'da var, Electron'da yok): var gibi görünür, kullanılırsa izin yok hatası verir
        if (!('share' in N)) {
          N.share = yerlesik(() => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')));
          N.canShare = yerlesik(() => false);
        }
      },
    });
  } catch {}
}

const LOGO = 'data:image/png;base64,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';

function kur() {
  if (window !== window.top) return;
  let etkin = false;
  ipcRenderer.invoke('turbo:durum').then((d) => { etkin = Boolean(d && d.etkin); }).catch(() => {});

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
  const root = host.attachShadow({ mode: 'closed' });
  // innerHTML kullanılmaz: YouTube gibi Trusted Types zorunlu tutan sitelerde engellenir. Öğeler tek tek kurulur.
  const yeni = (etiket, sinif, metin) => {
    const e = document.createElement(etiket);
    if (sinif) e.className = sinif;
    if (metin != null) e.textContent = metin;
    return e;
  };
  const stil = yeni('style');
  stil.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
      .wrap { position: relative; }
      .btn { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 6px 11px 6px 7px;
        border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; line-height: 1;
        background: linear-gradient(135deg, #4338ca, #0891b2); box-shadow: 0 2px 10px rgba(0,0,0,.4); white-space: nowrap; }
      .btn:hover { filter: brightness(1.12); }
      .btn img { width: 18px; height: 18px; border-radius: 4px; }
      .caret { font-size: 10px; opacity: .85; }
      .menu { position: absolute; right: 0; top: calc(100% + 6px); width: 290px; max-height: 380px; overflow: auto;
        background: #1d2026; color: #e9ecf1; border: 1px solid #343a44; border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 6px; display: none; }
      .menu.open { display: block; }
      .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; border-bottom: 1px solid #2f343d; margin-bottom: 4px; }
      .head img { width: 20px; height: 20px; border-radius: 5px; }
      .title { font-size: 12px; color: #aab2bf; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .sec { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #7f8896; padding: 8px 8px 4px; }
      .item { all: unset; cursor: pointer; display: flex; justify-content: space-between; align-items: center; width: 100%;
        padding: 8px 10px; border-radius: 6px; font-size: 13px; color: #e9ecf1; box-sizing: border-box; }
      .item:hover, .item:focus { background: #2b5fd9; color: #fff; }
      .item .size { font-size: 12px; color: #8d96a4; margin-left: 12px; white-space: nowrap; }
      .item:hover .size, .item:focus .size { color: #dbe6ff; }
      .msg { padding: 12px 10px; font-size: 13px; color: #c5ccd6; display: flex; align-items: center; gap: 10px; }
      .err { color: #ffb4a8; }
      .spin { width: 16px; height: 16px; border: 2px solid #3a4150; border-top-color: #38bdf8; border-radius: 50%;
        animation: s .8s linear infinite; flex: none; }
      @keyframes s { to { transform: rotate(360deg); } }
      .toast { position: fixed; right: 18px; bottom: 18px; padding: 10px 14px; border-radius: 8px; color: #fff;
        background: #263238; font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,.4);
        opacity: 0; transition: opacity .2s; pointer-events: none; }
      .toast.on { opacity: 1; }`;
  const wrap = yeni('div', 'wrap');
  const btn = yeni('button', 'btn');
  btn.title = 'TurboDownloader ile indir';
  const btnLogo = yeni('img');
  btnLogo.alt = '';
  btnLogo.src = LOGO;
  btn.append(btnLogo, yeni('span', '', 'İndir'), yeni('span', 'caret', '▼'));
  const menu = yeni('div', 'menu');
  menu.setAttribute('role', 'menu');
  wrap.append(btn, menu);
  const toastEl = yeni('div', 'toast');
  root.append(stil, wrap, toastEl);
  let current = null;
  let hideTimer = 0;
  const cache = new Map(); // sayfa adresi -> kalite listesi

  function container() {
    const fs = document.fullscreenElement;
    return fs && fs.tagName !== 'VIDEO' ? fs : (document.body || document.documentElement);
  }
  function mount() {
    const c = container();
    if (host.parentNode !== c) c.appendChild(host);
  }
  document.addEventListener('fullscreenchange', () => { if (host.style.display !== 'none') mount(); });

  function toast(text) {
    mount();
    host.style.display = 'block';
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { toastEl.classList.remove('on'); scheduleHide(); }, 2800);
  }

  const menuOpen = () => menu.classList.contains('open');
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!menuOpen() && !toastEl.classList.contains('on')) host.style.display = 'none';
    }, 2500);
  }
  function closeMenu() {
    menu.classList.remove('open');
    scheduleHide();
  }

  // Bazı oynatıcılar (ör. YouTube) <video> öğesini görünen alanın dışına kaydırır; o durumda
  // videonun gerçekten göründüğü kutu, onu saran ilk yeterince büyük öğedir.
  function boxOf(video) {
    const r = video.getBoundingClientRect();
    const area = Math.max(1, r.width * r.height);
    for (let a = video.parentElement, i = 0; a && i < 8; a = a.parentElement, i++) {
      const p = a.getBoundingClientRect();
      if (p.width < 160 || p.height < 90) continue;
      const ow = Math.max(0, Math.min(r.right, p.right) - Math.max(r.left, p.left));
      const oh = Math.max(0, Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top));
      return ow * oh < area * 0.5 ? p : r;
    }
    return r;
  }

  function place(video) {
    const r = boxOf(video);
    if (r.width < 160 || r.height < 90) return false;
    mount();
    host.style.display = 'block';
    host.style.top = Math.max(4, r.top + 8) + 'px';
    host.style.left = Math.max(4, r.right - 112) + 'px';
    return true;
  }

  function videoAt(x, y) {
    for (const v of document.querySelectorAll('video')) {
      const r = boxOf(v);
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  let ticking = false;
  document.addEventListener('mousemove', (e) => {
    if (!etkin || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (e.composedPath().includes(host)) { clearTimeout(hideTimer); return; }
      if (menuOpen()) return;
      const v = videoAt(e.clientX, e.clientY);
      if (v && place(v)) {
        current = v;
        scheduleHide();
      }
    });
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    if (menuOpen() && !e.composedPath().includes(host)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen()) closeMenu(); }, true);

  // ------------------------------------------------------------ menü
  const fmt = (n) => {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return '~' + (i >= 2 ? n.toFixed(i === 3 ? 2 : 0) : Math.round(n)) + ' ' + u[i];
  };
  const el = yeni;

  function videoSrc() {
    const src = current ? (current.currentSrc || current.src || '') : '';
    return /^https?:/i.test(src) && !/\.(m3u8|mpd)(\?|$)/i.test(src) ? src : '';
  }

  function header(title) {
    const h = el('div', 'head');
    const img = el('img');
    img.src = LOGO;
    h.append(img, el('div', 'title', title || 'TurboDownloader'));
    return h;
  }

  function item(label, size, onClick) {
    const b = el('button', 'item');
    b.append(el('span', '', label));
    if (size) b.append(el('span', 'size', fmt(size)));
    b.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      e.stopPropagation();
      closeMenu();
      onClick();
    });
    return b;
  }

  async function sonuc(istek, basari) {
    try {
      const r = await istek;
      toast(r && r.error ? '⚠ ' + r.error : basari);
    } catch {
      toast('⚠ TurboDownloader başlatılamadı');
    }
  }

  function choose(mode, quality, source) {
    sonuc(ipcRenderer.invoke('turbo:indir', { mode, quality, source, src: videoSrc() }),
      mode === 'audio' ? '♪ MP3 indirmesi başladı' : '⬇ İndirme başladı');
  }

  function chooseDirect(src) {
    sonuc(ipcRenderer.invoke('turbo:dogrudan', { src }), '⬇ İndirme başladı');
  }

  function render(data) {
    menu.textContent = '';
    if (!data) {
      menu.append(header(document.title));
      const m = el('div', 'msg');
      m.append(el('div', 'spin'), el('span', '', 'Kaliteler alınıyor…'));
      menu.append(m);
      return;
    }
    menu.append(header(data.title || document.title));
    const direct = videoSrc();
    if (data.error || !Array.isArray(data.options)) {
      menu.append(el('div', 'msg err', 'Kaliteler alınamadı: ' + (data.error || 'bilinmeyen yanıt')));
      if (direct) menu.append(item('Videoyu dosya olarak indir', 0, () => chooseDirect(direct)));
      menu.append(item('En iyi kalitede dene', 0, () => choose('video', 0, '')));
      menu.append(item('MP3 olarak dene', 0, () => choose('audio', 320, '')));
      return;
    }
    const vids = data.options.filter((o) => o.kind === 'video');
    const auds = data.options.filter((o) => o.kind === 'audio');
    if (vids.length) {
      menu.append(el('div', 'sec', 'Video (MP4)'));
      vids.forEach((o) => menu.append(item(o.label, o.size, () => choose('video', o.q, data.source))));
    }
    if (auds.length) {
      menu.append(el('div', 'sec', 'Ses'));
      auds.forEach((o) => menu.append(item(o.label, o.size, () => choose('audio', o.q, data.source))));
    }
  }

  function openMenu() {
    menu.classList.add('open');
    clearTimeout(hideTimer);
    const page = location.href;
    const hit = cache.get(page);
    if (hit && !hit.error) { render(hit); return; }
    render(null);
    ipcRenderer.invoke('turbo:formatlar', { src: videoSrc() })
      .catch(() => ({ error: 'TurboDownloader başlatılamadı' }))
      .then((r) => {
        const data = r || { error: 'TurboDownloader başlatılamadı' };
        if (!data.error) cache.set(page, data);
        if (menuOpen() && location.href === page) render(data);
      });
  }

  btn.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    e.stopPropagation();
    if (menuOpen()) closeMenu();
    else openMenu();
  });

  // Ayar değişince (ör. Ayarlar'dan kapatılınca) ana süreç bildirir
  ipcRenderer.on('turbo:etkin', (_e, deger) => {
    etkin = Boolean(deger);
    if (!etkin) host.style.display = 'none';
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur, { once: true });
else kur();
