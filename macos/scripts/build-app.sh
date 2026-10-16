#!/usr/bin/env bash
# Build Pux.app (ad-hoc signed) and zip it. Usage: build-app.sh [--version X]
# Output: macos/Pux.app, macos/Pux-<version>.zip; last two lines are the zip
# path and its sha256.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$MACOS_DIR/.." && pwd)"

VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || { echo "error: --version needs a value" >&2; exit 2; }
      VERSION="$2"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    *) echo "usage: build-app.sh [--version X]" >&2; exit 2 ;;
  esac
done
if [ -z "$VERSION" ]; then
  VERSION="$(cd "$REPO_DIR" && node -p "require('./package.json').version")"
fi
case "$VERSION" in
  ''|*[!0-9A-Za-z.+-]*) echo "error: invalid version '$VERSION'" >&2; exit 2 ;;
esac

cd "$MACOS_DIR"
swift build -c release --product PuxBar
BIN_DIR="$(swift build -c release --show-bin-path)"

APP="$MACOS_DIR/Pux.app"
ZIP="$MACOS_DIR/Pux-$VERSION.zip"
rm -rf "$APP" "$ZIP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/PuxBar" "$APP/Contents/MacOS/PuxBar"
sed "s/__VERSION__/$VERSION/g" "$MACOS_DIR/Resources/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >&2

codesign --force --sign - --identifier sh.pux.bar "$APP"
ditto -c -k --norsrc --keepParent "$APP" "$ZIP"

echo "$ZIP"
shasum -a 256 "$ZIP" | awk '{print $1}'
