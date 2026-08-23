#!/usr/bin/env bash
# scripts/ios-test/e2e.sh — Execute Maestro native iOS simulator end-to-end flows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RUN_ID="$(date +%Y%m%dT%H%M%S)-e2e-$RANDOM"
echo "=================================================="
echo " Starting Plethora iOS Simulator E2E Flow Runner"
echo " Run ID: $RUN_ID"
echo "=================================================="

# 1. Bootstrap Simulator
bash "$SCRIPT_DIR/bootstrap.sh"
SIM_UDID=$(cat /tmp/plethora_active_sim_udid)

# 2. Check Maestro
if ! command -v maestro >/dev/null 2>&1; then
  echo "⚠️ Maestro CLI is not installed on this host."
  echo "ℹ️ Install with: curl -fsSL 'https://get.maestro.mobile.dev' | bash"
  echo "⏩ Running fallback simctl smoke verification..."
  bash "$SCRIPT_DIR/smoke.sh"
  exit 0
fi

# 3. Execute Maestro Flows
cd "$REPO_ROOT"
FLOWS_DIR="$REPO_ROOT/tests/ios/flows"

if [ ! -d "$FLOWS_DIR" ]; then
  echo "❌ Error: Flows directory missing at $FLOWS_DIR"
  exit 1
fi

TEST_STATUS=0
FAILURE_REASON=""

set +e
maestro --device "$SIM_UDID" test "$FLOWS_DIR"
FLOW_EXIT=$?
set -e

if [ "$FLOW_EXIT" -ne 0 ]; then
  TEST_STATUS=1
  FAILURE_REASON="maestro_flow_failure"
fi

# 4. Harvest Artifacts
bash "$SCRIPT_DIR/collect-logs.sh" "$RUN_ID"
ARTIFACT_DIR=$(cat /tmp/plethora_last_artifact_dir)

# 5. Classify
bash "$SCRIPT_DIR/crash-detect.sh" "$ARTIFACT_DIR" "$TEST_STATUS" "$FAILURE_REASON"

if [ "$TEST_STATUS" -eq 0 ]; then
  echo "🎉 All iOS E2E flows PASSED."
  exit 0
else
  echo "❌ iOS E2E flows FAILED."
  exit 1
fi
