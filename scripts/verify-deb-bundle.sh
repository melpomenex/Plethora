#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Bash 3 compatible alternative to mapfile
debs=()
while IFS= read -r line; do
  debs+=("$line")
done < <(find src-tauri/target -type f -path "*/release/bundle/deb/*.deb" | sort)

if [[ ${#debs[@]} -eq 0 ]]; then
  echo "No .deb files found under src-tauri/target/**/release/bundle/deb/"
  exit 1
fi

for deb in "${debs[@]}"; do
  echo "Verifying deb: $deb"
  listing="$(dpkg-deb -c "$deb")"

  # Tauri sidecars can appear as `whisper` or `whisper-<target>`.
  if ! grep -Eq '/whisper([^/ ]*)$' <<<"$listing"; then
    echo "Missing whisper sidecar in $deb"
    exit 1
  fi

  # NotebookLM is bundled for desktop release artifacts. Fail if the runtime
  # or its sidecar is absent so a release cannot silently regress to a
  # first-run Python installation.
  if grep -Eq '/notebooklm-runtime' <<<"$listing"; then
    echo "NotebookLM runtime directory found in $deb"

    # Check for notebooklm sidecar
    if grep -Eq '/notebooklm(-[^/ ]*)?$' <<<"$listing"; then
      echo "NotebookLM sidecar found in $deb"
    else
      echo "Missing NotebookLM sidecar in $deb"
      exit 1
    fi
  else
    echo "Missing NotebookLM runtime in $deb"
    exit 1
  fi
done

echo "Deb bundle verification passed."
