## 1. Windows release verification unblocked

- [x] 1.1 In `scripts/verify-transcription-sidecars.mjs`, resolve the tar
       executable explicitly on Windows (`${SystemRoot}\System32\tar.exe`
       when it exists, else `tar.exe`, else a clear failure) per design D4;
       keep `tar` on other platforms.
- [x] 1.2 Verify the in-flight (uncommitted) Windows fixes are complete and
       committed: `scripts/download-sidecars.js` (onnxruntime-only DLL copy,
       stale dev-DLL cleanup, `.sherpa-onnx-provisioned` version marker) and
       `scripts/verify-windows-bundles.ps1` (real `onnxruntime.dll`
       requirement, 7z archive pre-check) — do not revert them.
- [x] 1.3 Run `node scripts/verify-transcription-sidecars.mjs --root
       src-tauri/bin` locally (or document why a full local run is
       impossible) to confirm the script itself executes end-to-end on this
       machine.

## 2. Signature verification tooling

- [x] 2.1 Create `scripts/verify-update-artifact.mjs` implementing design
       D1: parse base64-of-box or raw-box `.sig` files, key-id check against
       the pubkey from `src-tauri/tauri.conf.json`, Ed25519 main-signature
       verify over `blake2b512(artifact)`, and global-signature verify over
       `sig ∥ trusted_comment`. CLI: `--pubkey-config <path> --artifact
       <path> --sig <path>` (+ optional `--check-digest <sha256>`).
- [x] 2.2 Add `scripts/__tests__/verify-update-artifact.test.mjs` (runs under
       `npm run test:scripts`) with: a generated known-good key/signature
       fixture, a known-bad fixture (flipped byte), the real v2.6.0 AppImage
       signature as a valid vector and the v2.6.1 signature as an invalid
       vector (embed signature strings + pubkey from tauri.conf.json; use
       small synthetic artifacts for byte-level cases, the signature strings
       only for box-parsing cases).
- [x] 2.3 `npm run test:scripts` passes.

## 3. Release pipeline gates

- [x] 3.1 In `.github/workflows/release.yml` `release-appimage`: after the
       "Sign repacked AppImage for updater" step, add a "Verify AppImage
       updater signature" step running `node
       scripts/verify-update-artifact.mjs --pubkey-config
       src-tauri/tauri.conf.json --artifact <AppImage> --sig <AppImage>.sig`
       (fails the job on mismatch).
- [x] 3.2 In the `create-update-manifest` job's platform map, change
       `windows-x86_64` to `required: true` (design D3); update the job
       comment explaining why Windows missing must fail the manifest.
- [x] 3.3 Add a `verify-release` job: `needs: [create-update-manifest]`,
       skipped when `windows_only` is true (same condition as the manifest
       job); checks out, downloads the published `latest.json` from the
       release, asserts `darwin-aarch64`/`linux-x86_64`/`windows-x86_64`
       entries exist, downloads each referenced artifact, and runs
       `verify-update-artifact.mjs` against the manifest `signature` field
       for each; also compares each asset digest against the GitHub API
       record when `--check-digest` is supported.
- [x] 3.4 Confirm the in-flight `windows_only`/`build_ref` dispatch inputs
       (already in the working tree) remain intact and that `verify-release`
       honors them; extend the release-readiness summary to mention
       `verify-release` result.
- [x] 3.5 YAML sanity: `actionlint` (or careful review) on
       `.github/workflows/release.yml`; verify job `needs` graph is acyclic
       and `sync-release-notes` ordering is unchanged.

## 4. Bundle-type-aware update offer (Linux)

- [x] 4.1 Add a desktop-gated Rust command `updater_bundle_type` in
       `src-tauri/src/lib.rs` (or commands module) returning
       `tauri::utils::platform::bundle_type()` as a string ("appimage" |
       "deb" | "rpm" | "app" | "unknown"); register it and add the
       capability permission if required by the capabilities config.
- [x] 4.2 In `src/utils/updateChecker.ts` `checkViaTauriUpdater`: on Linux,
       query `updater_bundle_type`; when `deb` or `rpm`, return the manual
       `UpdateInfo` (`updater: null`) with a new `manualOnlyReason: "deb"`
       field (extend the `UpdateInfo` type; keep the skip-version logic).
- [x] 4.3 In `UpdateAvailableDialog.tsx`: when `manualOnlyReason` is set,
       render a "download the new package" primary action (reuses the
       opener/manual-download path) instead of "Update Now"; keep release
       notes and skip/remind actions unchanged.
- [x] 4.4 Update/extend `src/utils/__tests__/updateChecker.test.ts` for the
       Linux deb/rpm branch and the unchanged AppImage/macOS/Windows paths;
       `npm run test:run -- src/utils/__tests__/updateChecker.test.ts`
       passes.

## 5. Error surfacing

- [x] 5.1 In `UpdateAvailableDialog.handleUpdateNow`, normalize rejections
       (`Error.message` / plain string / JSON.stringify fallback), render the
       normalized text in the error panel above the manual-download link, and
       keep the existing console.error (design D6).
- [x] 5.2 Verify the "installed but could not relaunch" path also renders its
       message (existing behavior) and that Escape/backdrop close remain
       disabled during download/install.

## 6. Validation

- [x] 6.1 Full local gates: `npm run test:scripts` (68 tests: 67 pass, 0
       fail, 1 pre-existing skip), `npm run test:run --
       src/utils/__tests__/updateChecker.test.ts` (17/17), MainLayout/
       command-palette neighbor suites (12/12), `npx tsc --noEmit` (clean),
       `cargo check` (clean), eslint on changed files (0 errors; 1
       pre-existing warning untouched). `npm run bench:check` not run: none
       of the touched files (updateChecker, dialog, CI scripts, lib.rs
       command) are covered by any `src/**/*.bench.ts` suite.
- [ ] 6.2 Cut the next patch release (e.g. v2.6.2) per the release skill and
       watch: Windows job green through verify + upload; AppImage sign→verify
       green; manifest includes `windows-x86_64`; `verify-release` green.
- [ ] 6.3 After the release: re-download `latest.json` and each artifact,
       verify signatures out-of-band (same script), and confirm an AppImage
       install and a Windows install can update in place to the new version.
       Backfill v2.6.1 with `windows_only` only if still needed.
