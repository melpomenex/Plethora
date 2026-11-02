#!/usr/bin/env bash
# Verify generated local-media fixtures with FFprobe.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${MEDIA_FIXTURE_DIR:-$ROOT_DIR/src-tauri/tests/fixtures/media/generated}"

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is unavailable; skipping fixture verification"
  exit 0
fi
if [[ ! -d "$OUT_DIR" ]]; then
  echo "No generated fixtures at $OUT_DIR; run scripts/media-fixtures/generate.sh"
  exit 0
fi

status=0
shopt -s nullglob
files=("$OUT_DIR"/*.mp4 "$OUT_DIR"/*.mkv "$OUT_DIR"/*.webm)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No media fixtures found in $OUT_DIR"
  exit 0
fi

for file in "${files[@]}"; do
  printf '%s: ' "$(basename "$file")"
  if ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$file" >/dev/null 2>&1; then
    ffprobe -v error -show_entries stream=index,codec_type,codec_name \
      -of compact=p=0:nk=1 "$file" | tr '\n' ' '
    echo
  else
    echo "INVALID"
    status=1
  fi
done

if [[ -n "${PLETHORA_PGS_FIXTURE:-}" ]]; then
  printf 'external PGS fixture: '
  ffprobe -v error -show_entries stream=index,codec_type,codec_name \
    -of compact=p=0:nk=1 "$PLETHORA_PGS_FIXTURE" | tr '\n' ' '
  echo
fi

exit "$status"
