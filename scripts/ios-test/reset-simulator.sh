#!/usr/bin/env bash
# scripts/ios-test/reset-simulator.sh — Terminate processes and reset simulator state

set -euo pipefail

BUNDLE_ID="com.plethora.app"

if [ -f /tmp/plethora_active_sim_udid ]; then
  SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
else
  SIM_UDID="${SIMULATOR_UDID:-booted}"
fi

echo "🛑 Terminating $BUNDLE_ID on simulator $SIM_UDID..."
xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID" 2>/dev/null || true

if [ "${1:-}" == "--erase" ]; then
  echo "🧹 Erasing $BUNDLE_ID application container data..."
  APP_DATA=$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)
  if [ -n "$APP_DATA" ] && [ -d "$APP_DATA" ]; then
    rm -rf "$APP_DATA/Documents"/* "$APP_DATA/Library/Caches"/* 2>/dev/null || true
  fi
fi

echo "✅ Simulator reset complete."
