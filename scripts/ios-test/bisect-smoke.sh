#!/usr/bin/env bash
# scripts/ios-test/bisect-smoke.sh — git bisect wrapper with standard exit codes (0, 1, 125)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

echo "=================================================="
echo " Running Git Bisect Smoke Check on $(git rev-parse --short HEAD)"
echo "=================================================="

# 1. Check if commit has minimum required build dependencies
if [ ! -f "package.json" ] || [ ! -d "src-tauri" ]; then
  echo "⚠️ Untestable commit: missing package.json or src-tauri. Skipping (exit 125)..."
  exit 125
fi

# 2. Attempt clean build check
if ! npm run build:check >/tmp/bisect_build.log 2>&1 && ! npm run build >/tmp/bisect_build.log 2>&1; then
  echo "⚠️ Build failed during compilation. Skipping (exit 125)..."
  cat /tmp/bisect_build.log | tail -n 20
  exit 125
fi

# 3. Execute Smoke Test
set +e
bash "$SCRIPT_DIR/smoke.sh"
SMOKE_STATUS=$?
set -e

if [ "$SMOKE_STATUS" -eq 0 ]; then
  echo "✅ Commit $(git rev-parse --short HEAD) is GOOD (exit 0)."
  exit 0
else
  echo "❌ Commit $(git rev-parse --short HEAD) is BAD (exit 1)."
  exit 1
fi
