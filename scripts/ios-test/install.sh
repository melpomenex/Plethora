#!/usr/bin/env bash
# scripts/ios-test/install.sh — Build and install Plethora to the iOS Simulator

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f /tmp/plethora_active_sim_udid ]; then
  SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
else
  SIM_UDID="${SIMULATOR_UDID:-booted}"
fi

echo "🔨 Building Plethora for iOS Simulator (aarch64-sim)..."
cd "$REPO_ROOT"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  rm -rf "$REPO_ROOT/src-tauri/gen/apple/build/arm64-sim" "$REPO_ROOT/src-tauri/gen/apple/build/plethora-tauri_iOS.xcarchive"
  npm run tauri:ios:build:sim
fi

# Locate produced .app bundle
APP_BUNDLE=$(find "$REPO_ROOT/src-tauri/gen/apple/build" "$REPO_ROOT/src-tauri/target" -name "Plethora.app" -o -name "plethora-tauri_iOS.app" 2>/dev/null | head -n 1 || true)

if [ -z "$APP_BUNDLE" ] || [ ! -d "$APP_BUNDLE" ]; then
  # Fallback to standard Xcode DerivedData if present
  APP_BUNDLE=$(find ~/Library/Developer/Xcode/DerivedData -name "plethora-tauri_iOS.app" -o -name "Plethora.app" 2>/dev/null | head -n 1 || true)
fi

if [ -z "$APP_BUNDLE" ] || [ ! -d "$APP_BUNDLE" ]; then
  echo "❌ Error: Could not locate built .app bundle after simulator build."
  exit 1
fi

echo "📦 Found app bundle: $APP_BUNDLE"
echo "📲 Installing to simulator $SIM_UDID..."
xcrun simctl install "$SIM_UDID" "$APP_BUNDLE"

echo "✅ Installed successfully."
echo "APP_BUNDLE_PATH=$APP_BUNDLE" > /tmp/plethora_active_app_bundle
