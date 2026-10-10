# Android native feedback repair acceptance

This guide accompanies the existing `native-mobile-haptics` and
`fix-native-mobile-back-navigation` OpenSpec changes. A successful build or IPC
response is not physical haptic or system-gesture acceptance.

## Build configuration

Use JDK 17, SDK platform/build-tools 36 and NDK 27.2.12479018. Export
`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `NDK_HOME` and add Java and SDK
platform-tools to `PATH` in the same shell as the build. On the repair host:

```bash
export JAVA_HOME=/home/ubuntu/.local/share/plethora-android-repair/jdk
export ANDROID_HOME=/home/ubuntu/.local/share/plethora-android-repair/sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# Internal enabled debug APK with the explicit haptic diagnostic surface.
export ORG_GRADLE_PROJECT_plethoraNativeBackEnabled=true
export VITE_PLETHORA_HAPTIC_DIAGNOSTICS=true
npm run tauri:android:build -- --debug
```

The expected debug artifact is
`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
Debug defaults native Back on; the explicit override makes acceptance intent
unambiguous. For internal release/R8 validation use the same explicit Back
override with `npm run tauri:android:build`. The expected release path is
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
The diagnostic compile flag is only for internal testing; omit it from an
ordinary distributed build. Ordinary release packaging remains blocked until
the mandatory physical acceptance matrix is recorded. Explicit `false` is an
unsupported diagnostic rollback, not a working Back replacement.

Generated-project integration must pass the Android build preflight. See
[Android build notes](android-build-notes.md) before regenerating the project;
never overwrite the working project simply to produce a test result.

## Install without discarding data

```bash
adb devices -l
adb -s DEVICE_SERIAL install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb -s DEVICE_SERIAL shell dumpsys package com.plethora.app
adb -s DEVICE_SERIAL shell am start -n com.plethora.app/.MainActivity
```

Replace `DEVICE_SERIAL` with the attached authorized device. If installing
reports a signing mismatch, use the signing identity of the installed app or a
separate test device; do not uninstall a data-bearing app to bypass it.
Record the APK SHA-256, source revision plus uncommitted diff, BuildConfig
`NATIVE_BACK_ENABLED`, build variant, model/API/WebView version and navigation
mode. Inspect merged manifest predictive Back routing, plugin wiring, scoped
permissions and release R8 retained classes/models.

## Haptic smoke and interaction acceptance

Open the mobile haptic settings in an internal diagnostic build. Keep Android
touch feedback enabled and app haptics enabled; wait for configuration readiness.
Select Subtle, Standard and Strong in turn and request the diagnostic completion
effect at each level. Record policy admission, native result, API constant and
`platformAccepted`, alongside a human observer's felt/not-felt result. Equivalent
Android styles across levels are expected; no arbitrary motor amplitude is promised.

A missing interaction produces no event record; policy suppression, pending or
rejected configuration, absent plugin, stale/background/rate-limited native
request and Android system refusal must remain distinguishable. `submitted`
means the platform accepted the API call, not that a person felt vibration.

1. Explicitly reveal and grade a flashcard; feel each accepted effect once.
2. Exercise joystick detents, a completed session and a newly crossed milestone.
3. Disable haptics, repeat, and observe no native perform; re-enable and repeat.
4. Disable sound while keeping haptics on; then reverse the settings.
5. Exercise primary tabs, context menu, save highlight/extract/bookmark, Queue
   commit, Library mutation and first pull-to-refresh threshold.
6. Cancel gestures/prompts, scroll/type/change pages and run background work;
   observe no added application haptic.
7. Disable Android touch feedback; record refusal/suppression without override.
8. Background/resume, restart and rotate; repeat to expose initialization races.

## Native Back acceptance

Test both gesture and three-button navigation. On predictive Back-capable API
levels cancel a gesture before commit and observe no view change, haptic, data
loss or background action. Commit exactly once and observe one logical transition.

1. Navigate Dashboard → Queue → Document → Settings. Back must return through
   Settings → Document → Queue → Dashboard in chronological order.
2. Open a dialog/menu/drawer/sheet; Back dismisses the top eligible surface
   without leaving its underlying view. Repeat nested Settings and reader context.
3. Modify an unsaved form; Back prompts. Cancel leaves the view and draft intact.
   Accept completes once and uses the original completion identity.
4. At exhausted root, Back may background via `moveTaskToBack(true)`. A missing
   frontend session, failed/lost ACK or timeout must not silently exit/replay.
5. Open keyboard, fullscreen and an OS picker; preserve their native ownership.
6. Exercise horizontal Library scroll, EPUB/PDF gestures, joystick, Queue swipes,
   selection handles and long-press menus; none may double-navigate.
7. Restart and repeat with persisted state, plus tablet/fullscreen where available.

Record controller installation, listener registration, attach epoch,
request/claim/ACK results and view history mutations without private content.
Retain the detailed mandatory device rows in each change's validation file.
Physical Android, cross-OEM haptic and iPhone checks stay unchecked until performed.
