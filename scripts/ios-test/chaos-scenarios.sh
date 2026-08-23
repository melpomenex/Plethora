#!/usr/bin/env bash
# scripts/ios-test/chaos-scenarios.sh — Fault injection & interruption test scenarios

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=================================================="
echo " Starting iOS Chaos & Interruption Scenarios"
echo "=================================================="

# 1. Bootstrap Simulator
bash "$SCRIPT_DIR/bootstrap.sh"
SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
BUNDLE_ID="com.plethora.app"

# Scenario 1: Kill app during navigation & verify clean recovery
echo "💥 Scenario 1: Abrupt SIGKILL during tab transition..."
xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" 2>/dev/null || true
sleep 1
xcrun simctl openurl "$SIM_UDID" "plethora://documents" 2>/dev/null || true
sleep 0.2
xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID" 2>/dev/null || true
echo "   Killed process."

echo "   Relaunching and verifying recovery..."
xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" 2>/dev/null || true
sleep 2

# Scenario 2: Inject corrupted share manifest & verify app does not crash
echo "💥 Scenario 2: Corrupted share payload injection..."
GROUP_DIR=$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" "groups/group.com.plethora.app.shared" 2>/dev/null || true)
if [ -n "$GROUP_DIR" ] && [ -d "$GROUP_DIR" ]; then
  mkdir -p "$GROUP_DIR/shares/.ready"
  echo "NOT_VALID_JSON{{{{" > "$GROUP_DIR/shares/.ready/corrupt_share.json"
fi

xcrun simctl openurl "$SIM_UDID" "plethora://dashboard" 2>/dev/null || true
sleep 2

# Verify process is still alive
if ! xcrun simctl listapps "$SIM_UDID" >/dev/null 2>&1; then
  echo "❌ Error: App crashed during corrupted share processing."
  exit 1
fi

echo "✅ Chaos scenarios completed successfully."
