#!/usr/bin/env bash
# Generate small, synthetic local-media fixtures for compatibility tests.
# No copyrighted movie content is used or downloaded.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${MEDIA_FIXTURE_DIR:-$ROOT_DIR/src-tauri/tests/fixtures/media/generated}"
mkdir -p "$OUT_DIR"

list_fixtures() {
  cat <<'EOF'
mp4-h264-aac.mp4
webm-vp9-opus.webm
mkv-h264-aac.mkv
mkv-h264-aac-srt.mkv
mkv-h264-aac-multi-audio.mkv
mkv-h264-aac-cover.mkv
mkv-hevc-aac.mkv            (requires libx265)
mkv-hevc-dts.mkv            (requires libx265 + dca)
mkv-av1-opus.mkv            (requires libsvtav1 or libaom-av1 + libopus)
hdr10-hevc.mp4              (requires libx265)
EOF
}

if [[ "${1:-}" == "--list" ]]; then
  list_fixtures
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to generate fixtures" >&2
  exit 1
fi
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is required to verify fixtures" >&2
  exit 1
fi

video_src=(-f lavfi -i "testsrc2=size=320x180:rate=24:duration=2")
audio_src=(-f lavfi -i "sine=frequency=440:duration=2")
has_encoder() {
  local encoders
  encoders="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
  grep -qE "[[:space:]]$1[[:space:]]" <<<"$encoders"
}

echo "Generating fixtures in $OUT_DIR"

ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" "${audio_src[@]}" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT_DIR/mp4-h264-aac.mp4"

ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" "${audio_src[@]}" \
  -c:v libvpx-vp9 -b:v 500k -c:a libopus -shortest "$OUT_DIR/webm-vp9-opus.webm"

ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/mp4-h264-aac.mp4" \
  -c copy "$OUT_DIR/mkv-h264-aac.mkv"

printf '1\n00:00:00,000 --> 00:00:01,500\nSynthetic subtitle\n' > "$OUT_DIR/fixture.srt"
ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/mp4-h264-aac.mp4" \
  -i "$OUT_DIR/fixture.srt" -map 0:v -map 0:a -map 1:s -c copy \
  -metadata:s:s:0 language=eng "$OUT_DIR/mkv-h264-aac-srt.mkv"
rm -f "$OUT_DIR/fixture.srt"

ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/mp4-h264-aac.mp4" \
  -f lavfi -i "sine=frequency=880:duration=2" -map 0:v -map 0:a -map 1:a \
  -c:v copy -c:a aac -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa \
  "$OUT_DIR/mkv-h264-aac-multi-audio.mkv"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=blue:size=320x180:rate=24:duration=1" \
  -frames:v 1 -c:v mjpeg "$OUT_DIR/cover.jpg"
ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/mp4-h264-aac.mp4" \
  -i "$OUT_DIR/cover.jpg" -map 0 -map 1 -c copy -disposition:v:1 attached_pic \
  "$OUT_DIR/mkv-h264-aac-cover.mkv"
rm -f "$OUT_DIR/cover.jpg"

if has_encoder libx265; then
  ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" "${audio_src[@]}" \
    -c:v libx265 -x265-params log-level=error -pix_fmt yuv420p \
    -c:a aac -shortest "$OUT_DIR/mkv-hevc-aac.mkv"
  if has_encoder dca; then
    ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" "${audio_src[@]}" \
      -c:v libx265 -x265-params log-level=error -pix_fmt yuv420p \
      -c:a dca -strict -2 -ac 6 -ar 48000 -shortest "$OUT_DIR/mkv-hevc-dts.mkv"
  fi
  ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" \
    -c:v libx265 \
    -x265-params "log-level=error:hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" \
    -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 \
    -colorspace bt2020nc "$OUT_DIR/hdr10-hevc.mp4"
fi

if has_encoder libsvtav1 || has_encoder libaom-av1; then
  av1_encoder=libsvtav1
  if ! has_encoder libsvtav1; then av1_encoder=libaom-av1; fi
  if has_encoder libopus; then
    ffmpeg -hide_banner -loglevel error -y "${video_src[@]}" "${audio_src[@]}" \
      -c:v "$av1_encoder" -c:a libopus -shortest "$OUT_DIR/mkv-av1-opus.mkv"
  fi
fi

echo "Done. Run scripts/media-fixtures/verify.sh to inspect the generated files."
