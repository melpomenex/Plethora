#!/usr/bin/env bash
# scripts/ios-test/sample-hang.sh — Capture native process backtraces for deadlocks/hangs

set -euo pipefail

ARTIFACT_DIR="${1:-/tmp}"
BUNDLE_ID="com.plethora.app"

echo "🔍 Locating process for $BUNDLE_ID..."
PID=$(pgrep -f "Plethora" | head -n 1 || true)

if [ -z "$PID" ]; then
  echo "⚠️ Process for $BUNDLE_ID not found."
  exit 0
fi

echo "🧵 Sampling hung process $PID for 3 seconds..."
sample "$PID" 3 -file "$ARTIFACT_DIR/hang_sample.txt" 2>/dev/null || true

echo "🧵 Extracting LLDB thread backtraces..."
lldb --batch -p "$PID" -o "thread backtrace all" -o "quit" > "$ARTIFACT_DIR/lldb_threads.txt" 2>&1 || true

echo "✅ Saved deadlock stack samples to $ARTIFACT_DIR/hang_sample.txt and lldb_threads.txt"
