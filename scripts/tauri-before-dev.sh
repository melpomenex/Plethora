#!/usr/bin/env bash
set -euo pipefail

# tauri.conf.json beforeDevCommand. scripts/tauri-wrapper.sh may have already
# started the Vite dev server on this port; in that case starting another one
# would fail with "Port 15173 is already in use".
port=15173
dev_url="http://127.0.0.1:$port"
target_url="$dev_url/plethora-build-target.json"

dev_server_ready() {
  command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "$dev_url" >/dev/null 2>&1
}

dev_server_is_tauri() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -fsS --max-time 2 "$target_url" 2>/dev/null | grep -q '"target":"tauri"'
}

if dev_server_ready && dev_server_is_tauri; then
  echo "Tauri dev server already running at $dev_url"
  exit 0
fi

if dev_server_ready; then
  echo "Replacing non-Tauri dev server on port $port with PLETHORA_TAURI=1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
  bash scripts/clean-frontend-artifacts.sh
fi

export PLETHORA_TAURI=1
exec npm run dev -- --host 127.0.0.1 --port "$port" --strictPort
