#!/usr/bin/env bash
# Build "Lighthouse Buddy.app" (Sheru's desktop window) with swiftc. macOS only.
# Rebuilds only when the sources change: every rebuild gets a new ad-hoc signature, and
# macOS then forgets privacy permissions (Accessibility) granted to the old binary.
# Usage: buddy/build.sh [--force]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/build/Lighthouse Buddy.app"
BIN="$APP/Contents/MacOS/LighthouseBuddy"
STAMP="$DIR/build/.source-hash"

[ "$(uname -s)" = "Darwin" ] || { echo "Lighthouse Buddy is macOS only; skipping." >&2; exit 0; }
command -v swiftc >/dev/null 2>&1 || {
  echo "swiftc not found. Install the Xcode Command Line Tools: xcode-select --install" >&2; exit 2; }

HASH="$(for f in "$DIR/macos/main.swift" "$DIR/macos/Info.plist" "$DIR/macos/AppIcon.icns"; do
  [ -f "$f" ] && cat "$f"; done | shasum | cut -d' ' -f1)"
if [ "${1:-}" != "--force" ] && [ -x "$BIN" ] && [ "$(cat "$STAMP" 2>/dev/null || true)" = "$HASH" ]; then
  echo "Lighthouse Buddy is up to date"
  exit 0
fi

echo "Building Lighthouse Buddy.app ..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$DIR/macos/Info.plist" "$APP/Contents/Info.plist"
[ -f "$DIR/macos/AppIcon.icns" ] && cp "$DIR/macos/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit -framework ApplicationServices \
  "$DIR/macos/main.swift" -o "$BIN"
codesign --force --sign - --identifier dev.lighthouse.buddy "$APP" >/dev/null 2>&1 || true
echo "$HASH" > "$STAMP"
echo "Built: $APP"
