#!/usr/bin/env bash
# Build a Google Play store AAB with production API URL and release signing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PLETHORA_BUILD_PROFILE=store
export PLETHORA_TAURI=1
export VITE_PLETHORA_API_URL=https://api.useplethora.com

missing=()
for var in PLETHORA_KEYSTORE_FILE PLETHORA_KEYSTORE_PASSWORD PLETHORA_KEYSTORE_ALIAS PLETHORA_KEYSTORE_KEY_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Play store AAB requires release signing env vars:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "Generate an upload keystore and export these before building." >&2
  exit 1
fi

if [[ ! -f "$PLETHORA_KEYSTORE_FILE" ]]; then
  echo "ERROR: PLETHORA_KEYSTORE_FILE not found: $PLETHORA_KEYSTORE_FILE" >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.2.12479018}"

npm run build:tauri
bash scripts/tauri-wrapper.sh android build --ci --target aarch64 --aab

AAB="src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
if [[ ! -f "$AAB" ]]; then
  AAB="$(find src-tauri/gen/android/app/build/outputs/bundle -name '*.aab' -type f | head -1)"
fi

if [[ -z "$AAB" || ! -f "$AAB" ]]; then
  echo "ERROR: AAB not found under src-tauri/gen/android/app/build/outputs/bundle/" >&2
  exit 1
fi

echo "Store AAB: $AAB"
ls -lh "$AAB"

# Policy check: store builds must not request install packages permission.
if unzip -p "$AAB" base/manifest/AndroidManifest.xml 2>/dev/null | strings | grep -q 'REQUEST_INSTALL_PACKAGES'; then
  echo "ERROR: Store AAB contains REQUEST_INSTALL_PACKAGES" >&2
  exit 1
fi

echo "Manifest policy check passed (no REQUEST_INSTALL_PACKAGES)."
