#!/usr/bin/env bash
# scripts/ios-test/nightly.sh — Unattended Nightly Test Orchestrator for Mac mini

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DATE_STR=$(date +%Y%m%d_%H%M%S)
NIGHTLY_DIR="$REPO_ROOT/.test-artifacts/nightly/$DATE_STR"
mkdir -p "$NIGHTLY_DIR"

echo "=================================================="
echo " Starting Plethora Nightly Test Suite on Mac mini"
echo " Run Date: $DATE_STR"
echo " Artifacts: $NIGHTLY_DIR"
echo "=================================================="

RESULTS_FILE="$NIGHTLY_DIR/summary.json"
FAILED_STEPS=()

run_phase() {
  local phase_name="$1"
  shift
  echo ""
  echo "▶️ [Nightly Phase] $phase_name..."
  local start_t=$(date +%s)
  
  if "$@"; then
    local end_t=$(date +%s)
    local dur=$((end_t - start_t))
    echo "✅ [Passed] $phase_name (${dur}s)"
  else
    local end_t=$(date +%s)
    local dur=$((end_t - start_t))
    echo "❌ [Failed] $phase_name (${dur}s)"
    FAILED_STEPS+=("$phase_name")
  fi
}

cd "$REPO_ROOT"

# 1. Host Preflight
run_phase "Host Setup & Tooling Check" bash "$SCRIPT_DIR/setup.sh"

# 2. Simulator Reset
run_phase "Reset Simulator State" bash "$SCRIPT_DIR/reset-simulator.sh" --erase

# 3. Scripts & Tooling Tests
run_phase "Script Unit Tests" npm run test:scripts

# 4. Frontend Import Hardening Tests
run_phase "Frontend Store Hardening Tests" npx vitest run src/stores/__tests__/documentImportHardening.test.ts

# 5. Rust Invariant / Robustness Suite
run_phase "Rust Import Invariant & Robustness Suite" bash -c "cd src-tauri && cargo test --test import_robustness"

# 6. Simulator Smoke Test
run_phase "Native Simulator Smoke Test" bash "$SCRIPT_DIR/smoke.sh"

# 7. Chaos & Interruption Scenarios
run_phase "Chaos & Interruption Scenarios" bash "$SCRIPT_DIR/chaos-scenarios.sh"

# 8. Seeded UI Monkey Soak Run
run_phase "Seeded UI Monkey Soak Run" bash "$SCRIPT_DIR/soak.sh" 3 50

# 9. Summary & Report Generation
TOTAL_FAILED=${#FAILED_STEPS[@]}

node -e '
  const fs = require("fs");
  const failed = process.argv.slice(2);
  const summary = {
    date: process.env.DATE_STR,
    timestamp: new Date().toISOString(),
    status: failed.length === 0 ? "PASSED" : "FAILED",
    failedPhases: failed,
    platform: process.platform,
    arch: process.arch
  };
  fs.writeFileSync(process.env.RESULTS_FILE, JSON.stringify(summary, null, 2));
' "${FAILED_STEPS[@]}"

echo "=================================================="
if [ "$TOTAL_FAILED" -eq 0 ]; then
  echo "🎉 Nightly Test Suite PASSED with 0 errors!"
  echo "Summary: $RESULTS_FILE"
  exit 0
else
  echo "❌ Nightly Test Suite FAILED with $TOTAL_FAILED failing phase(s):"
  for f in "${FAILED_STEPS[@]}"; do
    echo "   - $f"
  done
  echo "Summary: $RESULTS_FILE"
  exit 1
fi
