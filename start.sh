#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"

# A packaged copy can be started without Node.js.
if [ -f "$APP_DIR/girlvoice" ]; then
  chmod +x "$APP_DIR/girlvoice"
  if [ -f "$APP_DIR/chrome_crashpad_handler" ]; then chmod +x "$APP_DIR/chrome_crashpad_handler"; fi
  exec "$APP_DIR/girlvoice" "$@"
fi
for build_dir in "$APP_DIR/release/direct/linux-unpacked" "$APP_DIR/release/monitoring/linux-unpacked" "$APP_DIR/release/final/linux-unpacked" "$APP_DIR/release/linux-unpacked"; do
  if [ -f "$build_dir/girlvoice" ]; then
    chmod +x "$build_dir/girlvoice"
    if [ -f "$build_dir/chrome_crashpad_handler" ]; then chmod +x "$build_dir/chrome_crashpad_handler"; fi
    exec "$build_dir/girlvoice" "$@"
  fi
done
for package in "$APP_DIR"/release/GirlVoice-*-Linux-x64.AppImage; do
  if [ -f "$package" ]; then
    chmod +x "$package"
    exec "$package" "$@"
  fi
done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Bitte Node.js 22 oder neuer mit npm installieren: https://nodejs.org/' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  printf '%s\n' 'Bitte Node.js auf Version 22 oder neuer aktualisieren.' >&2
  exit 1
fi
if [ ! -f node_modules/electron/dist/electron ]; then
  printf '%s\n' 'GirlVoice wird eingerichtet. Dies kann einige Minuten dauern.'
  npm ci
fi
exec npm start
