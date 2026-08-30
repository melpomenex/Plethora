#!/usr/bin/env bash
# Compare Linux Cargo job policy: CARGO_BUILD_JOBS=1 vs repository default.
# Run on Linux for meaningful results. Writes .cache/linux-cargo-jobs-bench.json
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/src-tauri"
RESULTS="$ROOT_DIR/.cache/linux-cargo-jobs-bench.json"
mkdir -p "$(dirname "$RESULTS")"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This benchmark targets Linux; results may not reflect .deb packaging." >&2
fi

measure_build() {
  local label="$1"
  local jobs="$2"
  cargo clean -q
  local start end elapsed peak_rss
  start=$(date +%s)
  if command -v /usr/bin/time >/dev/null 2>&1; then
    /usr/bin/time -v env CARGO_BUILD_JOBS="$jobs" cargo build --release -q 2>"$ROOT_DIR/.cache/time-$label.log" || true
    peak_rss=$(awk '/Maximum resident set size/ { print $NF }' "$ROOT_DIR/.cache/time-$label.log" | tail -1)
  else
    env CARGO_BUILD_JOBS="$jobs" cargo build --release -q
    peak_rss=0
  fi
  end=$(date +%s)
  elapsed=$((end - start))
  printf '{"label":"%s","jobs":%s,"seconds":%s,"peak_rss_kb":%s}\n' "$label" "$jobs" "$elapsed" "${peak_rss:-0}"
}

source "$ROOT_DIR/scripts/tauri-linux-build-env.sh"
default_jobs="$CARGO_BUILD_JOBS"

echo "Benchmarking cargo build --release (clean) ..."
one_job="$(measure_build one_job 1)"
default="$(measure_build default_jobs "$default_jobs")"

node -e "
const fs = require('fs');
const out = {
  recordedAt: new Date().toISOString(),
  defaultJobs: Number(process.argv[1]),
  results: [JSON.parse(process.argv[2]), JSON.parse(process.argv[3])],
};
fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
" "$default_jobs" "$one_job" "$default" "$RESULTS"
