#!/usr/bin/env bash
# scripts/ios-test/setup.sh — Validate Mac host prerequisites for iOS simulator testing

set -euo pipefail

echo "=================================================="
echo " Plethora iOS Simulator Test Environment Preflight"
echo "=================================================="

FAILED=0

# 1. macOS & Hardware Check
OS_NAME=$(uname -s)
if [ "$OS_NAME" != "Darwin" ]; then
  echo "❌ Error: iOS Simulator testing requires macOS (detected: $OS_NAME)."
  exit 1
fi
echo "✅ macOS host detected ($(sw_vers -productVersion))."

# 2. Xcode & Command Line Tools
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "❌ Error: xcodebuild is not available. Please install Xcode."
  FAILED=1
else
  XCODE_VER=$(xcodebuild -version | tr '\n' ' ')
  echo "✅ Xcode detected: $XCODE_VER"
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "❌ Error: xcrun is not available."
  FAILED=1
else
  echo "✅ xcrun is available."
fi

# 3. iOS Simulator Runtimes
if command -v xcrun >/dev/null 2>&1; then
  RUNTIMES=$(xcrun simctl list runtimes -j 2>/dev/null || true)
  if echo "$RUNTIMES" | grep -q '"isAvailable" : true' && echo "$RUNTIMES" | grep -q 'iOS'; then
    echo "✅ Active iOS Simulator runtime(s) detected."
  else
    echo "⚠️ Warning: No available iOS Simulator runtime found. Run 'xcodebuild -downloadPlatform iOS' or install via Xcode Settings."
    FAILED=1
  fi
fi

# 4. Rust iOS Targets
if command -v rustup >/dev/null 2>&1; then
  TARGETS=$(rustup target list --installed)
  if echo "$TARGETS" | grep -q "aarch64-apple-ios-sim"; then
    echo "✅ Rust target 'aarch64-apple-ios-sim' is installed."
  else
    echo "❌ Rust target 'aarch64-apple-ios-sim' is missing. Run: rustup target add aarch64-apple-ios-sim"
    FAILED=1
  fi
else
  echo "⚠️ Warning: rustup not found in PATH."
fi

# 5. Node.js & NPM
if command -v node >/dev/null 2>&1; then
  echo "✅ Node.js detected: $(node --version)"
else
  echo "❌ Error: Node.js is not available."
  FAILED=1
fi

# 6. Maestro (Optional / High-Level E2E)
if command -v maestro >/dev/null 2>&1; then
  echo "✅ Maestro CLI detected ($(maestro --version 2>/dev/null || echo 'installed'))."
else
  echo "ℹ️ Note: Maestro CLI not detected. Install with: curl -fsSL 'https://get.maestro.mobile.dev' | bash"
fi

echo "=================================================="
if [ "$FAILED" -eq 0 ]; then
  echo "🎉 Environment check passed! Ready for iOS simulator testing."
  exit 0
else
  echo "❌ Some required prerequisites are missing. Please remediate the items above."
  exit 1
fi
