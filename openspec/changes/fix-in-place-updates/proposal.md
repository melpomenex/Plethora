## Why

Users on macOS, Windows, and Linux see "The in-place update failed. You can
still download the installer manually." instead of the app updating itself.
Diagnosis of the v2.6.1 release found three independent breakages:

1. **Windows has had no updater artifacts since v2.3.0.** The
   `release (windows-x86_64)` job builds the NSIS installer and its `.sig`
   successfully, then dies at the "Verify Windows bundles" step — first from
   `spawnSync tar ENOENT` in `scripts/verify-transcription-sidecars.mjs`
   (Windows runners don't resolve `tar` through Node's `spawnSync`), and
   separately from a real packing regression where the NSIS bundle shipped
   only the 10 KB `onnxruntime_providers_shared.dll` shim instead of the real
   `onnxruntime.dll`. Because the matrix leg is `required: false` with
   `continue-on-error`, the failure is silent: no `-setup.exe`/`.sig` upload,
   so `latest.json` carries no `windows-x86_64` entry and Windows in-place
   update is impossible.
2. **The v2.6.1 Linux AppImage signature does not match the uploaded artifact
   bytes.** Verified cryptographically against GitHub's own asset digests: the
   trusted-comment signature is valid (right key), but the main signature over
   blake2b512(asset) fails, so every AppImage user updating to v2.6.1 fails
   signature verification mid-install. The identical pipeline produced a valid
   v2.6.0 signature two hours earlier, so this is a release-pipeline flake
   that nothing currently detects — the manifest job copies the `.sig` asset
   content without ever checking it against the artifact.
3. **Linux deb/rpm installs can never in-place update** (the Tauri updater
   replaces the running executable at `/usr/bin/incrementum`, which is
   root-owned), yet the UI still offers the doomed in-place path.

Additionally, the update dialog discards the updater's actual error string
(Tauri rejects with plain strings, so `err instanceof Error` is false), which
is why users only ever see the generic message and we get no diagnosable
signal.

## What Changes

- Fix `scripts/verify-transcription-sidecars.mjs` to resolve `tar` robustly on
  Windows (`%SystemRoot%\System32\tar.exe` with fallbacks) so the Windows
  release verify step can pass.
- Incorporate the in-flight working-tree fixes (uncommitted at proposal time)
  for the Windows ONNX Runtime DLL packing regression
  (`scripts/download-sidecars.js`, `scripts/verify-windows-bundles.ps1`) and
  the `windows_only`/`build_ref` release backfill mode
  (`.github/workflows/release.yml`).
- Add `scripts/verify-update-artifact.mjs`: a pure-Node minisign verifier
  (blake2b512 + Ed25519 via `node:crypto`, mirroring the updater's
  `minisign-verify` semantics) that checks a `.sig` against artifact bytes
  using the pubkey from `tauri.conf.json`.
- Add release gates that use it: (a) sign→verify before upload in the
  AppImage job (the re-signed repack is the one artifact signed outside the
  bundler), and (b) a post-publication `verify-release` job that fetches the
  released `latest.json`, downloads every platform artifact, and verifies
  each signature — turning the v2.6.1 class of silent breakage into a loud
  release failure.
- Make `windows-x86_64` a **required** platform in the update-manifest job so
  a missing Windows artifact fails the release instead of silently shipping a
  manifest without Windows.
- Add a Rust `updater_bundle_type` command (wraps
  `tauri::utils::platform::bundle_type()`); on Linux the update dialog offers
  in-place install only for AppImage installs and gives deb/rpm installs a
  direct "download the new .deb" flow instead of a guaranteed failure.
- Surface the real updater error (`String(err)`) in the update dialog and log
  it, keeping the manual-download fallback.

## Capabilities

### New Capabilities
- `in-place-updates`: The end-to-end contract for in-place app updates —
  per-platform updater artifacts with verified signatures on every release, a
  complete `latest.json` manifest for macOS/Windows/Linux, platform-honest
  install offers (AppImage-only in-place on Linux), and actionable error
  surfacing in the update UI.

### Modified Capabilities

## Impact

- **Release pipeline** (`.github/workflows/release.yml`): new verification
  steps/job; Windows promoted to required in the manifest gate; interacts
  with the in-flight `windows_only`/`build_ref` edits (backfill dispatches
  must keep skipping manifest regeneration).
- **Build scripts**: `scripts/verify-transcription-sidecars.mjs` (tar
  resolution), new `scripts/verify-update-artifact.mjs` + unit tests under
  `scripts/__tests__/` (`npm run test:scripts`).
- **Rust** (`src-tauri/src/lib.rs` + commands): new read-only
  `updater_bundle_type` command, desktop-gated like the updater plugin.
- **Frontend** (`src/utils/updateChecker.ts`,
  `src/components/settings/UpdateAvailableDialog.tsx`): bundle-type-aware
  updater handle on Linux; real error strings in the dialog.
- **Out of scope**: linux-aarch64 AppImage builds, darwin-x86_64,
  macOS notarization/Developer ID signing, Android/iOS update flows.
