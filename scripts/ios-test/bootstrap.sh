#!/usr/bin/env bash
# scripts/ios-test/bootstrap.sh — Provision and boot the target iOS Simulator

set -euo pipefail

TARGET_DEVICE="${SIMULATOR_DEVICE:-iPhone 17 Pro}"
echo "🔍 Resolving simulator device: '$TARGET_DEVICE'..."

# Find matching available simulator
DEVICES_JSON=$(xcrun simctl list devices available -j)
DEVICE_INFO=$(echo "$DEVICES_JSON" | node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  const target = process.argv[1];
  let found = null;
  for (const [runtime, list] of Object.entries(data.devices)) {
    if (!runtime.includes("iOS")) continue;
    for (const d of list) {
      if (d.isAvailable && (d.name === target || d.udid === target)) {
        found = { ...d, runtime };
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    // Fallback: pick any available iPhone
    for (const [runtime, list] of Object.entries(data.devices)) {
      if (!runtime.includes("iOS")) continue;
      for (const d of list) {
        if (d.isAvailable && d.name.includes("iPhone")) {
          found = { ...d, runtime };
          break;
        }
      }
      if (found) break;
    }
  }
  if (found) {
    console.log(JSON.stringify(found));
  } else {
    process.exit(1);
  }
' "$TARGET_DEVICE" || true)

if [ -z "$DEVICE_INFO" ]; then
  echo "❌ Error: Could not find any available iOS simulator matching '$TARGET_DEVICE'."
  exit 1
fi

SIM_UDID=$(echo "$DEVICE_INFO" | node -e 'console.log(JSON.parse(fs.readFileSync(0, "utf8")).udid)')
SIM_NAME=$(echo "$DEVICE_INFO" | node -e 'console.log(JSON.parse(fs.readFileSync(0, "utf8")).name)')
SIM_STATE=$(echo "$DEVICE_INFO" | node -e 'console.log(JSON.parse(fs.readFileSync(0, "utf8")).state)')

echo "📱 Target simulator: $SIM_NAME ($SIM_UDID) — State: $SIM_STATE"

if [ "$SIM_STATE" != "Booted" ]; then
  echo "🚀 Booting simulator $SIM_UDID..."
  xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
fi

open -a Simulator 2>/dev/null || true

echo "⏳ Waiting for simulator boot completion..."
xcrun simctl bootstatus "$SIM_UDID" -b

echo "✅ Simulator ready: $SIM_NAME ($SIM_UDID)"
echo "SIMULATOR_UDID=$SIM_UDID"
echo "$SIM_UDID" > /tmp/plethora_active_sim_udid
