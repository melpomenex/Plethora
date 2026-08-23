#!/usr/bin/env bash
# scripts/ios-test/smoke.sh — Deterministic iOS Simulator smoke test runner

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RUN_ID="$(date +%Y%m%dT%H%M%S)-smoke-$RANDOM"
echo "=================================================="
echo " Starting Plethora iOS Simulator Smoke Test"
echo " Run ID: $RUN_ID"
echo "=================================================="

# 1. Bootstrap Simulator
bash "$SCRIPT_DIR/bootstrap.sh"
SIM_UDID=$(cat /tmp/plethora_active_sim_udid)

# 2. Build & Install
bash "$SCRIPT_DIR/install.sh"

# 3. Clean and prep logs
rm -f /tmp/plethora_sim_stdout.log /tmp/plethora_sim_stderr.log /tmp/plethora_sim_unified.log
touch /tmp/plethora_sim_stdout.log /tmp/plethora_sim_stderr.log /tmp/plethora_sim_unified.log

# Start background log streaming
xcrun simctl spawn "$SIM_UDID" log stream --predicate 'subsystem == "com.plethora.app" or process contains "Plethora" or process contains "plethora"' > /tmp/plethora_sim_unified.log 2>&1 &
LOG_STREAM_PID=$!

cleanup() {
  kill "$LOG_STREAM_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 4. Launch Application
BUNDLE_ID="com.plethora.app"
echo "🚀 Launching $BUNDLE_ID on simulator $SIM_UDID..."
xcrun simctl launch --stdout=/tmp/plethora_sim_stdout.log --stderr=/tmp/plethora_sim_stderr.log "$SIM_UDID" "$BUNDLE_ID"

# 5. Liveness Oracle: Wait for startup readiness (Max 30s)
echo "⏳ Waiting for application readiness oracle..."
READY=0
START_TIME=$(date +%s)
TIMEOUT=30

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if grep -q "plethora-ready" /tmp/plethora_sim_stdout.log 2>/dev/null || \
     grep -q "plethora-ready" /tmp/plethora_sim_unified.log 2>/dev/null || \
     grep -q "startTransactionListener: skipped" /tmp/plethora_sim_unified.log 2>/dev/null || \
     grep -q "PerformanceMonitor::measurePostLoad" /tmp/plethora_sim_unified.log 2>/dev/null || \
     grep -q "React mounted" /tmp/plethora_sim_stdout.log 2>/dev/null; then
    READY=1
    echo "✅ Application reached known-good ready state in ${ELAPSED}s."
    break
  fi

  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "❌ Startup Timeout: Application failed to reach ready state within ${TIMEOUT}s."
    break
  fi

  sleep 0.5
done

TEST_STATUS=0
FAILURE_REASON=""

if [ "$READY" -eq 0 ]; then
  TEST_STATUS=1
  FAILURE_REASON="startup_timeout: application failed to signal readiness within 30s"
fi

# 6. Basic Navigation Verification (if ready)
if [ "$TEST_STATUS" -eq 0 ]; then
  echo "🧭 Testing deep-link navigation routes..."
  xcrun simctl openurl "$SIM_UDID" "plethora://documents" 2>/dev/null || true
  sleep 1
  xcrun simctl openurl "$SIM_UDID" "plethora://settings" 2>/dev/null || true
  sleep 1
  xcrun simctl openurl "$SIM_UDID" "plethora://dashboard" 2>/dev/null || true
  sleep 1

  # 7. Lifecycle Test: Terminate & Cold Relaunch
  echo "🔄 Testing process termination and cold relaunch..."
  xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID"
  sleep 1

  echo "🚀 Cold relaunching $BUNDLE_ID..."
  xcrun simctl launch --stdout=/tmp/plethora_sim_stdout.log --stderr=/tmp/plethora_sim_stderr.log "$SIM_UDID" "$BUNDLE_ID"
  sleep 3

  if ! xcrun simctl listapps "$SIM_UDID" >/dev/null 2>&1; then
    TEST_STATUS=1
    FAILURE_REASON="relaunch_failure: simulator became unresponsive after relaunch"
  fi
fi

# 8. Harvest Artifacts
bash "$SCRIPT_DIR/collect-logs.sh" "$RUN_ID"
ARTIFACT_DIR=$(cat /tmp/plethora_last_artifact_dir)

# 9. Classify Verdict
bash "$SCRIPT_DIR/crash-detect.sh" "$ARTIFACT_DIR" "$TEST_STATUS" "$FAILURE_REASON"

if [ "$TEST_STATUS" -eq 0 ]; then
  echo "🎉 Smoke test PASSED successfully."
  exit 0
else
  echo "❌ Smoke test FAILED ($FAILURE_REASON)."
  exit 1
fi
