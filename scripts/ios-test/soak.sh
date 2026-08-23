#!/usr/bin/env bash
# scripts/ios-test/soak.sh — Long-running stability and memory soak test runner

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CYCLES="${1:-5}"
STEPS_PER_CYCLE="${2:-100}"

echo "=================================================="
echo " Starting iOS Stability & Soak Test ($CYCLES cycles of $STEPS_PER_CYCLE steps)"
echo "=================================================="

for i in $(seq 1 "$CYCLES"); do
  SEED=$((RANDOM * 1000 + i))
  echo "🌀 Soak Cycle $i/$CYCLES (Seed: $SEED)..."
  node "$SCRIPT_DIR/monkey.mjs" --seed "$SEED" --steps "$STEPS_PER_CYCLE"
  sleep 2
done

echo "🎉 All $CYCLES soak cycles completed successfully!"
