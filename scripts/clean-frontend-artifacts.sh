#!/usr/bin/env bash
# Remove frontend build outputs and Vite's dependency pre-bundle cache.
# The .vite cache is dev-oriented but can retain stale optimized deps after
# target/env changes (web vs tauri), causing dev/release mismatches.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

rm -rf \
  "$root/dist" \
  "$root/node_modules/.vite" \
  "$root/.eslintcache"

echo "Cleaned dist/, node_modules/.vite/, and .eslintcache"
