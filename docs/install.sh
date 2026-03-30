#!/usr/bin/env sh
set -e

REPO="usestackbox/stackbox"
API="https://api.github.com/repos/${REPO}/releases/latest"

echo "🔍 Fetching latest Stackbox release..."
RELEASE=$(curl -fsSL "$API")

get_url() {
  echo "$RELEASE" | grep -o "\"browser_download_url\": *\"[^\"]*$1[^\"]*\"" | head -1 | sed 's/.*: *"\(.*\)"/\1/'
}

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then
      URL=$(get_url "aarch64.dmg")
      FILE="Stackbox-aarch64.dmg"
    else
      URL=$(get_url "x64.dmg")
      FILE="Stackbox-x64.dmg"
    fi
    ;;
  Linux)
    URL=$(get_url ".AppImage")
    FILE="Stackbox.AppImage"
    ;;
  *)
    echo "❌ Auto-install not supported on Windows. Download from:"
    echo "   https://usestackbox.github.io/stackbox/"
    exit 1
    ;;
esac

if [ -z "$URL" ] || [ "$URL" = "" ]; then
  echo "❌ Could not find a matching release asset."
  echo "   Visit: https://github.com/${REPO}/releases"
  exit 1
fi

DEST="$HOME/Downloads/$FILE"
echo "⬇  Downloading $FILE..."
curl -fL --progress-bar -o "$DEST" "$URL"

if [ "$OS" = "Darwin" ]; then
  echo "📦 Opening installer..."
  open "$DEST"
  echo "✅ Done! Drag Stackbox to your Applications folder."
elif [ "$OS" = "Linux" ]; then
  chmod +x "$DEST"
  echo "✅ Saved to $DEST"
  echo "   Run with: $DEST"
fi