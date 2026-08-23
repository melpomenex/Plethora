#!/usr/bin/env bash
# scripts/ios-test/inject-fixture.sh — Inject a test fixture file into simulator app container

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIXTURE_NAME="${1:-sample-note.md}"
FIXTURE_SRC="$REPO_ROOT/tests/ios/fixtures/$FIXTURE_NAME"

if [ ! -f "$FIXTURE_SRC" ]; then
  # Fall back to src-tauri fixtures
  FIXTURE_SRC="$REPO_ROOT/src-tauri/tests/fixtures/documents/text/$FIXTURE_NAME"
fi

if [ ! -f "$FIXTURE_SRC" ]; then
  echo "❌ Error: Fixture file not found: $FIXTURE_SRC"
  exit 1
fi

if [ -f /tmp/plethora_active_sim_udid ]; then
  SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
else
  SIM_UDID="${SIMULATOR_UDID:-booted}"
fi

BUNDLE_ID="com.plethora.app"
APP_DATA=$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)

if [ -z "$APP_DATA" ] || [ ! -d "$APP_DATA" ]; then
  echo "❌ Error: Could not locate app container for $BUNDLE_ID on simulator $SIM_UDID."
  exit 1
fi

DEST_DIR="$APP_DATA/Documents/imports"
mkdir -p "$DEST_DIR"
cp "$FIXTURE_SRC" "$DEST_DIR/$FIXTURE_NAME"

echo "✅ Injected fixture '$FIXTURE_NAME' into $DEST_DIR"
