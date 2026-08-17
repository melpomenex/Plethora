---
name: android-build
description: Build the PLETHORA Android APK and install it to a connected phone. Use whenever the user wants to build the APK, make an android build, send/install the app to their phone, or test on mobile. Covers setting up the Android SDK/NDK env vars, running the Tauri android build, locating the output APK, and installing via adb.
---

# Build & install the PLETHORA Android APK

End-to-end mobile build workflow for this Tauri app. The build itself is `npm run tauri:android:build` (which runs `tauri android build --ci --target aarch64 --apk`), but the build fails instantly if `ANDROID_HOME` / `NDK_HOME` aren't set — that is the #1 (and so far only) way this build has failed. This skill makes sure the env is right before wasting a full Gradle+Rust compile.

## Prerequisites — check these BEFORE running the build

1. **Locate the Android SDK.** On this machine it is installed via the Homebrew cask `android-commandlinetools` at:

   ```
   /opt/homebrew/share/android-commandlinetools
   ```

   Verify it exists with `ls /opt/homebrew/share/android-commandlinetools/platforms`. If the dir is missing entirely, the cask needs installing: `brew install --cask android-commandlinetools` (rare — it's already installed here).

2. **Confirm the NDK is present.** The NDK lives inside the SDK dir:

   ```bash
   ls /opt/homebrew/share/android-commandlinetools/ndk
   ```

   It should show a version dir like `27.2.12479018`. That's the NDK version Tauri 2 expects. Export `NDK_HOME` pointing at the full version path (see step 3).

3. **The env vars are NOT in the shell profile** — they must be set in the same command that runs the build. Set all three together:

   ```bash
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   export ANDROID_SDK_ROOT=$ANDROID_HOME
   export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018   # use the actual version from step 2
   ```

   (`ANDROID_SDK_ROOT` is set defensively; Tauri checks `ANDROID_HOME` and `NDK_HOME` directly.)

   If you'd rather not set these every time, offer to add them to `~/.zshrc` — but don't do it unprompted.

## Build the APK

Run the build in the **background** (it takes several minutes — full Gradle build plus Rust cross-compile for aarch64):

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools && \
export ANDROID_SDK_ROOT=$ANDROID_HOME && \
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018 && \
npm run tauri:android:build
```

- Use `run_in_background: true` and a long timeout (600000 ms). You'll be notified on completion.
- If it fails with "Android SDK not found" / "ANDROID_HOME not set" → the env vars weren't set in that same command. Re-run with them set (don't trust a prior shell's exports — shell state does not persist between tool calls).
- Any other failure is a real code/config error — read the tail of the log and report it; don't blindly retry.

## Locate the output APK

The build writes a single universal release APK to a fixed path:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Confirm it exists and check its size (~30–40 MB is normal):

```bash
find src-tauri/gen/android -name "*.apk" -type f -exec ls -lh {} \;
```

## Install to a connected phone

1. **Find the device.** The user's phone is a **Pixel 9 Pro XL**, serial `47241FDAS006KM`, connected over USB:

   ```bash
   adb devices -l
   ```

   The serial can change across reconnects, so always read it from `adb devices` rather than hardcoding it. If no device shows up:
   - Ask the user to plug in / authorize USB debugging on the phone.
   - The `adb` on PATH is the Homebrew one at `/opt/homebrew/bin/adb`; the SDK also ships its own at `$ANDROID_HOME/platform-tools/adb`. Either works.

2. **Install (reinstall over the existing copy):**

   ```bash
   adb -s <SERIAL> install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
   ```

   `-r` reinstalls and keeps data. Expect `Success`. If you get `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signature mismatch, e.g. switching between debug/release builds), uninstall first: `adb -s <SERIAL> uninstall com.plethora.app`, then reinstall.

3. **Verify it landed:**

   ```bash
   adb -s <SERIAL> shell dumpsys package com.plethora.app | grep -E "versionName|lastUpdateTime"
   ```

   The package name is `com.plethora.app` and `versionName` tracks the project version from `package.json` / `tauri.conf.json`.

## Notes

- The app's package name on this device is `com.plethora.app`. Two other PLETHORA packages may coexist (`com.PLETHORA.incrementum_mobile`, `com.PLETHORA.android.debug`) — don't install over those; target `com.plethora.app`.
- The APK is `universal`, so it works on arm64 and x86_64 emulators alike — no per-ABI selection needed.
- This build does **not** require a clean git tree or a version bump; it builds whatever is in the working directory. That's the point — it's for getting the current code onto the phone for testing.
- Mobile UI differs from desktop; if the user is testing a specific feature on mobile, mention any mobile-specific caveats you know of after install.
