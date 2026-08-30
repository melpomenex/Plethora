#!/usr/bin/env bash
# Remove frontend build outputs. Preserves Vite and ESLint caches unless --deep.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deep=0
force_dist=0
expect_target=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep)
      deep=1
      shift
      ;;
    --force-dist)
      force_dist=1
      shift
      ;;
    --expect-target=*)
      expect_target="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

metadata="$root/dist/plethora-build-metadata.json"
remove_dist=0

if (( force_dist )); then
  remove_dist=1
elif [[ ! -d "$root/dist" ]]; then
  remove_dist=0
elif [[ ! -f "$metadata" ]]; then
  remove_dist=1
elif [[ -n "$expect_target" ]]; then
  current_target="$(node -e "const m=require('$metadata'); console.log(m.target)" 2>/dev/null || echo unknown)"
  if [[ "$current_target" != "$expect_target" ]]; then
    remove_dist=1
  fi
else
  remove_dist=1
fi

if (( remove_dist )); then
  rm -rf "$root/dist"
  echo "Removed dist/ (missing, forced, or build-target mismatch)"
else
  echo "Keeping dist/ (build target matches${expect_target:+: $expect_target})"
fi

if (( deep )); then
  rm -rf "$root/node_modules/.vite" "$root/.eslintcache"
  echo "Deep clean: removed node_modules/.vite/ and .eslintcache"
fi
