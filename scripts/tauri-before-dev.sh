#!/usr/bin/env bash
set -euo pipefail

# tauri.conf.json beforeDevCommand. scripts/tauri-wrapper.sh may have already
# started the Vite dev server on this port; in that case starting another one
# would fail with "Port 15173 is already in use".
port=15173
dev_url="http://127.0.0.1:$port"

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 2 "$dev_url" >/dev/null 2>&1; then
    echo "Dev server already running at $dev_url; skipping npm run dev"
    exit 0
  fi
fi

exec npm run dev
