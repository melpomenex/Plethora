#!/usr/bin/env bash
# scripts/ios-test/collect-logs.sh — Aggregate logs, screenshots, and crash reports

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RUN_ID="${1:-$(date +%Y%m%dT%H%M%S)-run-$RANDOM}"
ARTIFACT_DIR="$REPO_ROOT/.test-artifacts/ios/$RUN_ID"
mkdir -p "$ARTIFACT_DIR"

if [ -f /tmp/plethora_active_sim_udid ]; then
  SIM_UDID=$(cat /tmp/plethora_active_sim_udid)
else
  SIM_UDID="${SIMULATOR_UDID:-booted}"
fi

echo "📋 Harvesting test artifacts into $ARTIFACT_DIR..."

# 1. Screenshot
xcrun simctl io "$SIM_UDID" screenshot "$ARTIFACT_DIR/screenshot.png" 2>/dev/null || true

# 2. Metadata
cd "$REPO_ROOT"
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
DIRTY_STATE=$(git status --porcelain 2>/dev/null | grep -q . && echo "true" || echo "false")

node -e '
  const fs = require("fs");
  const meta = {
    runId: process.argv[1],
    timestamp: new Date().toISOString(),
    commit: process.argv[2],
    branch: process.argv[3],
    dirty: process.argv[4] === "true",
    simulatorUdid: process.argv[5],
    platform: process.platform,
    nodeVersion: process.version
  };
  fs.writeFileSync(process.argv[6] + "/metadata.json", JSON.stringify(meta, null, 2));
' "$RUN_ID" "$COMMIT_SHA" "$BRANCH_NAME" "$DIRTY_STATE" "$SIM_UDID" "$ARTIFACT_DIR"

# 3. Crash Reports (.ips)
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"
if [ -d "$CRASH_DIR" ]; then
  # Find newest crash log matching plethora created in the last 10 minutes
  NEWEST_IPS=$(find "$CRASH_DIR" -type f -name "*plethora*.ips" -mmin -10 2>/dev/null | head -n 1 || true)
  if [ -n "$NEWEST_IPS" ] && [ -f "$NEWEST_IPS" ]; then
    echo "⚠️ Found native crash report: $NEWEST_IPS"
    cp "$NEWEST_IPS" "$ARTIFACT_DIR/crash.ips"
  fi
fi

# 4. Copy stdout / stderr / unified log if captured to temp
if [ -f /tmp/plethora_sim_stdout.log ]; then
  cp /tmp/plethora_sim_stdout.log "$ARTIFACT_DIR/stdout.log" || true
fi
if [ -f /tmp/plethora_sim_stderr.log ]; then
  cp /tmp/plethora_sim_stderr.log "$ARTIFACT_DIR/stderr.log" || true
fi
if [ -f /tmp/plethora_sim_unified.log ]; then
  cp /tmp/plethora_sim_unified.log "$ARTIFACT_DIR/unified.log" || true
fi

echo "$ARTIFACT_DIR" > /tmp/plethora_last_artifact_dir
echo "✅ Artifacts saved to: $ARTIFACT_DIR"
