#!/usr/bin/env bash
# Tor Expert Bundle'ın en son kararlı Windows sürümünü indirir, Tor Projesi imzasıyla doğrular ve tor-paket/ klasörüne açar.
# İmza veya parmak izi tutmazsa hiçbir şey değiştirmeden hata verir.
set -euo pipefail

KOK="$(cd "$(dirname "$0")/.." && pwd)"
TEMEL="https://dist.torproject.org/torbrowser"
PARMAK_IZI="EF6E286DDA85EA2A4BA7DE684E2C6E8793298290"   # Tor Browser Developers imza anahtarı
ANAHTAR_URL="https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/kounek7zrdx745qydx6p59t9mqjpuhdf"

SURUM="$(curl -fsSL "$TEMEL/" | grep -oE 'href="[0-9]+\.[0-9]+(\.[0-9]+)?/"' | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | sort -V | tail -1)"
[ -n "$SURUM" ] || { echo "Tor sürümü bulunamadı" >&2; exit 1; }
DOSYA="tor-expert-bundle-windows-x86_64-$SURUM.tar.gz"

if [ -f "$KOK/tor-paket/SURUM" ] && [ "$(cat "$KOK/tor-paket/SURUM")" = "$SURUM" ]; then
  echo "Tor zaten güncel: $SURUM"
  exit 0
fi

GECICI="$(mktemp -d)"
trap 'rm -rf "$GECICI"' EXIT
cd "$GECICI"
curl -fsSLO "$TEMEL/$SURUM/$DOSYA"
curl -fsSLO "$TEMEL/$SURUM/$DOSYA.asc"
curl -fsSL -o anahtar.pgp "$ANAHTAR_URL"

export GNUPGHOME="$GECICI/gnupg"
mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"
gpg --batch --quiet --import anahtar.pgp 2>/dev/null || true
DURUM="$(gpg --batch --status-fd 1 --verify "$DOSYA.asc" "$DOSYA" 2>/dev/null || true)"
echo "$DURUM" | grep -q '^\[GNUPG:\] GOODSIG' || { echo "İMZA GEÇERSİZ: $DOSYA" >&2; exit 1; }
echo "$DURUM" | grep -q "^\[GNUPG:\] VALIDSIG .* $PARMAK_IZI\$" || { echo "İmza beklenen Tor anahtarından değil" >&2; exit 1; }

rm -rf "$KOK/tor-paket.yeni"
mkdir -p "$KOK/tor-paket.yeni"
tar --force-local -xzf "$DOSYA" -C "$KOK/tor-paket.yeni"
[ -f "$KOK/tor-paket.yeni/tor/tor.exe" ] || { echo "Pakette tor.exe yok" >&2; exit 1; }
echo "$SURUM" > "$KOK/tor-paket.yeni/SURUM"
rm -rf "$KOK/tor-paket"
mv "$KOK/tor-paket.yeni" "$KOK/tor-paket"
echo "Tor güncellendi: $SURUM (imza doğrulandı)"
