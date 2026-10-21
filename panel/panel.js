const $ = (id) => document.getElementById(id);
const mesajlar = $('mesajlar');
const soru = $('soru');
const gonder = $('gonder');
let yaziyor = false;
let aktifBalon = null, aktifMetin = '';

function ekranGoster(anahtarVar) {
  $('kurulum').hidden = anahtarVar;
  $('sohbet').hidden = !anahtarVar;
  if (anahtarVar) soru.focus();
}

// Basit ve güvenli markdown: önce HTML kaçırılır, sonra sınırlı biçimler uygulanır
function kacir(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function satirIci(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
}
function markdown(metin) {
  const parcalar = kacir(metin).split(/```[^\n]*\n?/);
  let html = '';
  parcalar.forEach((p, i) => {
    if (i % 2 === 1) { html += `<pre><code>${p}</code></pre>`; return; }
    let liste = null;
    const kapatListe = () => { if (liste) { html += `</${liste}>`; liste = null; } };
    for (const blok of p.split(/\n{2,}/)) {
      for (const satir of blok.split('\n')) {
        const madde = /^\s*[-*•]\s+(.*)/.exec(satir);
        const sira = /^\s*\d+[.)]\s+(.*)/.exec(satir);
        const baslik = /^#{1,4}\s+(.*)/.exec(satir);
        if (madde || sira) {
          const tur = madde ? 'ul' : 'ol';
          if (liste !== tur) { kapatListe(); html += `<${tur}>`; liste = tur; }
          html += `<li>${satirIci((madde || sira)[1])}</li>`;
        } else if (baslik) {
          kapatListe(); html += `<h3>${satirIci(baslik[1])}</h3>`;
        } else if (satir.trim()) {
          kapatListe(); html += `<p>${satirIci(satir)}</p>`;
        }
      }
      kapatListe();
    }
  });
  return html;
}

function balonEkle(tur, metin) {
  $('karsilama')?.remove();
  const b = document.createElement('div');
  b.className = 'balon ' + tur;
  if (tur === 'asistan') b.innerHTML = markdown(metin);
  else b.textContent = metin;
  mesajlar.append(b);
  mesajlar.scrollTop = mesajlar.scrollHeight;
  return b;
}

function yaziyorAyarla(durum) {
  yaziyor = durum;
  gonder.textContent = durum ? '■' : '➤';
  gonder.title = durum ? 'Durdur' : 'Gönder';
  gonder.classList.toggle('durdur', durum);
}

async function sorGonder(metin) {
  metin = metin.trim();
  if (!metin || yaziyor) return;
  balonEkle('kullanici', metin);
  soru.value = '';
  aktifMetin = '';
  aktifBalon = balonEkle('asistan', '');
  aktifBalon.classList.add('imlec');
  yaziyorAyarla(true);
  const sonuc = await ai.sor(metin, $('sayfa-dahil').checked && !$('sayfa-dahil').disabled);
  aktifBalon.classList.remove('imlec');
  if (sonuc.hata) {
    if (!aktifMetin) aktifBalon.remove();
    balonEkle('hata', sonuc.hata);
  } else if (sonuc.reddedildi) {
    aktifBalon.remove();
    balonEkle('bilgi', 'Claude bu isteği güvenlik politikası nedeniyle yanıtlamadı.');
  } else {
    if (sonuc.durduruldu) balonEkle('bilgi', 'Yanıt durduruldu.');
    if (sonuc.kesildi) balonEkle('bilgi', 'Sayfa çok uzun olduğu için yalnızca ilk kısmı gönderildi.');
    if (sonuc.sinirda) balonEkle('bilgi', 'Yanıt uzunluk sınırına ulaştı.');
  }
  aktifBalon = null;
  yaziyorAyarla(false);
}

ai.parcaDinle((parca) => {
  if (!aktifBalon) return;
  aktifMetin += parca;
  aktifBalon.innerHTML = markdown(aktifMetin);
  mesajlar.scrollTop = mesajlar.scrollHeight;
});

ai.soruDinle((metin) => sorGonder(metin));

ai.sekmeDinle(({ tur }) => {
  const kutu = $('sayfa-dahil');
  const tor = tur === 'tor';
  kutu.disabled = tor;
  $('baglam').classList.toggle('kapali', tor);
  $('baglam-yazi').textContent = tor
    ? '🧅 Tor sekmesi: anonimliğin için sayfa içeriği AI\'ya gönderilmez'
    : 'Bu sayfayı bağlam olarak ekle';
});

$('soru-formu').onsubmit = (e) => {
  e.preventDefault();
  if (yaziyor) ai.durdur(); else sorGonder(soru.value);
};
soru.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!yaziyor) sorGonder(soru.value); }
});
soru.addEventListener('input', () => { soru.style.height = 'auto'; soru.style.height = soru.scrollHeight + 'px'; });
$('kisayollar').addEventListener('click', (e) => {
  const d = e.target.closest('button');
  if (d) sorGonder(d.dataset.soru);
});

$('yeni').onclick = () => {
  ai.sifirla();
  location.reload();
};
$('kapat').onclick = () => ai.kapat();
$('konsol').onclick = (e) => { e.preventDefault(); ai.konsoluAc(); };
$('ayar').onclick = async () => {
  const { anahtarVar } = await ai.durum();
  const kurulumAcik = !$('kurulum').hidden;
  if (kurulumAcik && anahtarVar) return ekranGoster(true);
  $('kurulum').hidden = false;
  $('sohbet').hidden = true;
  $('anahtar-sil').hidden = !anahtarVar;
};
$('anahtar-sil').onclick = async () => {
  await ai.anahtarSil();
  $('anahtar-sil').hidden = true;
  $('kurulum-mesaj').className = 'mesaj';
  $('kurulum-mesaj').textContent = 'Anahtar silindi.';
};
$('anahtar-formu').onsubmit = async (e) => {
  e.preventDefault();
  const m = $('kurulum-mesaj');
  const dugme = e.submitter;
  dugme.disabled = true;
  m.className = 'mesaj';
  m.textContent = 'Anahtar doğrulanıyor…';
  const sonuc = await ai.anahtarKaydet($('anahtar').value);
  dugme.disabled = false;
  if (sonuc.hata) {
    m.className = 'mesaj hata';
    m.textContent = sonuc.hata;
    return;
  }
  $('anahtar').value = '';
  m.textContent = '';
  ekranGoster(true);
};

ai.durum().then(({ anahtarVar }) => ekranGoster(anahtarVar));
