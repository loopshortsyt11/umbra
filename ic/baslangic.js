// Ana süreç sayfayı ?tur=gizli|tor&ara=<arama adresi öneki>&ad=<motor adı> ile açar.
const p = new URLSearchParams(location.search);
const tur = p.get('tur') === 'tor' ? 'tor' : 'gizli';
const ara = /^https:\/\//.test(p.get('ara') || '') ? p.get('ara') : 'https://search.brave.com/search?q=';
const motorAdi = p.get('ad') || 'Brave Search';

document.body.classList.add(tur);
document.title = tur === 'tor' ? 'Yeni Tor sekmesi' : 'Yeni gizli sekme';
document.getElementById('etiket').textContent = tur === 'tor' ? '🧅 Tor sekmesi' : '🕶 Gizli sekme';
const q = document.getElementById('q');
q.placeholder = `${motorAdi} ile ara veya adres yaz`;

const maddeler = tur === 'tor'
  ? ['Gerçek IP adresin gizli; trafiğin Tor ağındaki üç ayrı sunucudan geçiyor.',
    'Geçmiş, çerez ve önbellek tutulmaz; son Tor sekmesini kapatınca hepsi silinir.',
    `Aramaların Umbra AI'ya gönderilmez; izleyicisiz ${motorAdi} ile yapılır.`]
  : ['Geçmiş tutulmaz; çerezler ve site verileri son gizli sekmeyi kapatınca silinir.',
    `Aramaların Umbra AI'ya gönderilmez; izleyicisiz ${motorAdi} ile yapılır.`,
    'IP adresin sitelere görünür; onu da gizlemek için 🧅 Tor sekmesi kullan.'];
document.getElementById('aciklama').replaceChildren(...maddeler.map((m) => Object.assign(document.createElement('li'), { textContent: m })));

document.getElementById('form').onsubmit = (e) => {
  e.preventDefault();
  const t = q.value.trim();
  if (!t) return;
  if (/^https?:\/\//i.test(t)) location.href = t;
  else if (!/\s/.test(t) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) location.href = 'https://' + t;
  else location.href = ara + encodeURIComponent(t);
};
