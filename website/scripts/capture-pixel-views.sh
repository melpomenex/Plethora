#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SERIAL="${1:-47241FDAS006KM}"
OUT="${2:-/Volumes/external/mac-mini/Code/Plethora/website/docs/review/pixel-9-pro-xl}"
mkdir -p "$OUT"
adb -s "$SERIAL" reverse tcp:4321 tcp:4321

open_url() {
  adb -s "$SERIAL" shell am start -a android.intent.action.VIEW \
    -n com.android.chrome/com.google.android.apps.chrome.Main \
    -d "$1" >/dev/null
}

slugify() {
  if [ "$1" = "/" ]; then
    echo home
  else
    echo "${1#/}" | tr '/' '-'
  fi
}

ROUTES="/ /features /how-it-works /pricing /downloads /demo /docs /changelog /support /contact /privacy /security /terms /refunds /students /readers /researchers /spaced-repetition /incremental-reading /read-it-later /anki /docs/getting-started"

open_url "http://127.0.0.1:4321/"
sleep 4

for path in $ROUTES; do
  name=$(slugify "$path")
  open_url "http://127.0.0.1:4321${path}"
  if [ "$path" = "/demo" ]; then
    sleep 4
  else
    sleep 2.2
  fi
  adb -s "$SERIAL" exec-out screencap -p > "$OUT/${name}.png"
  bytes=$(wc -c < "$OUT/${name}.png" | tr -d " ")
  echo "captured ${name} (${bytes} bytes)"
done
