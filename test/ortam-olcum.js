// Tarayıcı ortamı ölçümü: Chrome ile Umbra arasındaki farkları bulmak için
window.__olc = (async () => {
  const o = {};
  const dene = (ad, f) => { try { o[ad] = f(); } catch (h) { o[ad] = 'HATA ' + h.message; } };
  dene('chrome_turu', () => typeof window.chrome);
  dene('chrome_anahtarlari', () => window.chrome ? Object.keys(window.chrome).sort() : null);
  dene('chrome_app', () => window.chrome && window.chrome.app ? Object.keys(window.chrome.app).sort() : null);
  dene('chrome_runtime', () => window.chrome && window.chrome.runtime ? Object.keys(window.chrome.runtime).sort().slice(0, 12) : null);
  dene('csi_loadTimes', () => window.chrome ? [typeof window.chrome.csi, typeof window.chrome.loadTimes] : null);
  dene('eklentiler', () => [...navigator.plugins].map((p) => p.name));
  dene('mime', () => [...navigator.mimeTypes].map((m) => m.type));
  dene('pdfViewerEnabled', () => navigator.pdfViewerEnabled);
  dene('webdriver', () => navigator.webdriver);
  dene('diller', () => navigator.languages);
  dene('bildirim', () => typeof Notification !== 'undefined' ? Notification.permission : 'yok');
  dene('apiler', () => ['serial', 'hid', 'usb', 'bluetooth', 'share', 'contacts', 'credentials', 'xr', 'wakeLock', 'virtualKeyboard', 'windowControlsOverlay', 'ink', 'scheduling', 'login', 'storageBuckets', 'gpu', 'ml']
    .filter((a) => a in navigator));
  dene('pencere_apileri', () => ['showSaveFilePicker', 'showOpenFilePicker', 'documentPictureInPicture', 'launchQueue', 'IdentityCredential', 'PublicKeyCredential', 'PaymentRequest', 'Sanitizer', 'SharedStorage', 'Fence', 'BarcodeDetector', 'EyeDropper', 'getScreenDetails', 'queryLocalFonts', 'BatteryManager', 'NavigatorManagedData', 'TrustedTypePolicy']
    .filter((a) => a in window));
  dene('webgl', () => { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return [g.getParameter(d.UNMASKED_VENDOR_WEBGL), g.getParameter(d.UNMASKED_RENDERER_WEBGL)]; });
  dene('ekran', () => [screen.width, screen.height, screen.colorDepth, devicePixelRatio]);
  dene('dil_bolge', () => [Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language]);
  dene('donanim', () => [navigator.hardwareConcurrency, navigator.deviceMemory, navigator.maxTouchPoints]);
  dene('sesler', () => speechSynthesis.getVoices().length);
  dene('medyaCihazlari', () => !!navigator.mediaDevices);
  document.getElementById("c") && (document.getElementById("c").textContent = JSON.stringify(o));
  try { o.yuksek = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'wow64', 'formFactors', 'fullVersionList']); } catch (h) { o.yuksek = 'HATA'; }
  try { const e = await navigator.mediaDevices.enumerateDevices(); o.cihazTurleri = e.map((d) => d.kind); } catch { o.cihazTurleri = 'HATA'; }
  try { o.depolama = Math.round((await navigator.storage.estimate()).quota / 1e9) + ' GB'; } catch { o.depolama = 'HATA'; }
  try { o.izin_bildirim = (await navigator.permissions.query({ name: 'notifications' })).state; } catch { o.izin_bildirim = 'HATA'; }
  return o;
})();
