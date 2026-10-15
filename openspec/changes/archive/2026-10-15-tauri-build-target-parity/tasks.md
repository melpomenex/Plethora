## 1. Runtime target contract

- [x] 1.1 Create `src/lib/runtimeTarget.ts` with `FrontendRuntimeTarget`, Tauri 2 env detection, and conflict invariants.
- [x] 1.2 Wire `vite.config.ts` through the classifier; inject `__PLETHORA_RUNTIME_TARGET__`.
- [x] 1.3 Export `PLETHORA_TAURI=1` from `tauri-wrapper.sh` for dev/build/android/ios.
- [x] 1.4 Emit `dist/plethora-build-metadata.json` and expose `getBuildFingerprint()`.

## 2. Tests and verification

- [x] 2.1 Unit tests for Tauri dev, Tauri 2 production, PWA, web, and conflicting envs.
- [x] 2.2 Vite helper tests proving Tauri production → `isPWA false`.
- [x] 2.3 Production bundle build + metadata inspection script.
