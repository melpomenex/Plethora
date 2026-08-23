#!/usr/bin/env bash
# scripts/ios-test/inject-share.sh — Inject a share payload into the iOS App Group container

set -euo pipefail

SHARE_ID="share-$(date +%s)-$RANDOM"
SHARE_URL="${1:-https://example.com/research-article}"
SHARE_TITLE="${2:-Shared Research Article}"

if [ -f /tmp/plethora_active_sim_udid ]; then
  SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
else
  SIM_UDID="${SIMULATOR_UDID:-booted}"
fi

BUNDLE_ID="com.plethora.app"
APP_GROUP="group.com.plethora.app.shared"

GROUP_DIR=$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" "groups/$APP_GROUP" 2>/dev/null || true)

if [ -z "$GROUP_DIR" ] || [ ! -d "$GROUP_DIR" ]; then
  # Fallback to app data container if app group not resolved on simulator
  APP_DATA=$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" data 2>/dev/null || true)
  GROUP_DIR="$APP_DATA/Shared"
fi

READY_DIR="$GROUP_DIR/shares/.ready"
mkdir -p "$READY_DIR"

MANIFEST_FILE="$READY_DIR/$SHARE_ID.json"

cat <<EOF > "$MANIFEST_FILE"
{
  "id": "$SHARE_ID",
  "version": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "url",
  "url": "$SHARE_URL",
  "title": "$SHARE_TITLE"
}
EOF

echo "✅ Injected share payload '$SHARE_ID' to $READY_DIR"
