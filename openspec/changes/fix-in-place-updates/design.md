## Context

The in-app updater (`tauri-plugin-updater` 2.10.1, config in
`src-tauri/tauri.conf.json`, JS in `src/utils/updateChecker.ts` + dialog in
`src/components/settings/UpdateAvailableDialog.tsx`) fetches
`releases/latest/download/latest.json`, downloads the platform artifact, and
verifies its minisign signature before installing. Diagnosis of the shipped
v2.6.1 release established (with byte-level verification against GitHub's
asset digests):

- **Windows**: no `-setup.exe`/`.sig` on any release since v2.3.0. The
  Windows job builds the artifacts, then the "Verify Windows bundles" step
  crashes (`spawnSync tar ENOENT` in `verify-transcription-sidecars.mjs` —
  Node's `spawnSync("tar", …)` does not resolve `tar` on windows-latest) and,
  independently, the NSIS bundle stopped packing the real `onnxruntime.dll`
  (shim-only). `required: false` + `continue-on-error` masks all of it; the
  manifest job then drops the `windows-x86_64` entry as "optional".
- **Linux AppImage**: v2.6.1's manifest signature does not verify against the
  uploaded AppImage bytes (global signature valid ⇒ right key; main
  signature over blake2b512(asset) invalid; download digest matches
  GitHub's record; v2.6.0 verified with identical pipeline code ⇒ release
  flake). The AppImage is the only artifact signed *outside* tauri-bundler
  (manual `tauri signer sign` after the appimagetool repack), and nothing
  ever re-verifies it.
- **Linux deb/rpm**: the updater replaces the running executable
  (`extract_path = executable_path` on Linux) — `/usr/bin/incrementum` is
  root-owned, so in-place install is architecturally impossible for system
  packages; the UI should not offer it.
- **macOS**: chain verified valid end-to-end; remaining gap is error
  visibility (Tauri rejections are plain strings, so the dialog's
  `err instanceof Error ? err.message : fallback` always shows the generic
  fallback).

Uncommitted in-flight edits already in the working tree at proposal time
(and folded into this change): `scripts/download-sidecars.js` (Windows ONNX
DLL set fix + version-marker provisioning), `scripts/verify-windows-bundles.ps1`
(require real `onnxruntime.dll`, 7z archive pre-check), and
`.github/workflows/release.yml` (`windows_only`/`build_ref` backfill inputs).

## Goals / Non-Goals

**Goals:**
- Windows/macOS/Linux(AppImage) users can update in place from the dialog.
- Any signature/asset breakage in a release is caught by CI before users see
  it, with the release marked failed.
- deb/rpm Linux users get an honest, working download flow instead of a
  failed install.
- Real updater errors are visible to users and logs.

**Non-Goals:**
- Building linux-aarch64 AppImages or darwin-x86_64 updater artifacts.
- macOS notarization / Developer ID signing (app remains ad-hoc signed).
- deb/rpm *in-place* upgrade (would require a root helper or packagekit
  integration — not attempted).
- Android/iOS update flows (already separate APK path).

## Decisions

### D1: Pure-Node minisign verifier (`scripts/verify-update-artifact.mjs`)
Re-implements the updater's verification in `node:crypto`: parse the base64
signature box (untrusted comment / base64 sig line where bytes =
`alg(2) ∥ key_id(8) ∥ sig(64)` / trusted comment / base64 global-sig line),
require key-id match with the pubkey, verify the Ed25519 main signature over
`blake2b512(artifact)` (Node exposes `blake2b512` via OpenSSL 3) and the
Ed25519 global signature over `sig ∥ trusted_comment`. Accepts both the raw
box text and the base64-of-box form the Tauri CLI writes into `.sig` files.
Semantics validated against the real v2.6.0 (valid) and v2.6.1 (invalid)
artifacts plus a locally generated control signature.

*Why not Rust (a small cargo bin using `minisign-verify`)?* It matches the
updater bit-for-bit, but adds a compile step to release jobs that run on
three OSes; Node is already installed everywhere the script must run and the
scheme is small and now empirically pinned by unit tests with known-good and
known-bad vectors derived from the real artifacts.

*Why not `tauri signer verify`?* The CLI has no verify subcommand (2.10.0).

### D2: Two verification gates in `release.yml`
1. **Sign→verify (pre-upload)** in `release-appimage`, immediately after the
   re-sign step: `verify-update-artifact.mjs` over the local
   `Incrementum_<v>_amd64.AppImage` + `.sig`. Catches a flaky or wrong-key
   sign before anything ships.
2. **`verify-release` job** after `create-update-manifest` (and skipped in
   `windows_only` backfills, same condition as the manifest job): fetch the
   *published* `latest.json`, require the three platform entries, download
   each referenced asset, and verify each manifest `signature` against the
   downloaded bytes. This is the gate that would have failed v2.6.1: it
   checks exactly what a client updater checks, post-publication.

*Why post-publication at all?* The pre-upload gate can't see upload-side
corruption or a manifest↔asset mismatch; the updater's failure mode is
"what's on the release page", so that's what must be verified. Failure marks
the workflow run red (visible), and the release tag can be re-dispatched via
`build_ref` to rebuild just the broken pieces.

### D3: Windows becomes a required manifest platform
In the manifest job's platform map, `windows-x86_64` flips to
`required: true`. Rationale: the product requirement is that Windows users
in-place-update; "optional, dropped with a warning" is precisely what let
Windows rot from v2.4.0 to v2.6.1 unnoticed. The matrix leg stays
`required: false`/`continue-on-error` **only** so a Windows-only failure
doesn't cancel the macOS/Linux uploads (which must still publish so existing
users can update); the manifest job then fails the run overall. In
`windows_only` backfills the manifest job is skipped (per the in-flight
design), so no conflict.

### D4: `tar` resolution on Windows (transcription smoke test)
`verify-transcription-sidecars.mjs` resolves the extractor as: on `win32`,
`${SystemRoot|\windows}\System32\tar.exe` if it exists, else `tar.exe`, else
fail with a message; elsewhere `tar`. bsdtar (System32 tar) handles
`-xjf`. No other behavior changes.

### D5: Bundle-type-aware update offer on Linux
New desktop-only Rust command `updater_bundle_type()` returning
`tauri::utils::platform::bundle_type()` (compile-time patched by the bundler:
`Deb`, `Rpm`, `AppImage`; macOS ⇒ `App`). `updateChecker.ts` calls it on
Linux: for `AppImage` (or unknown — dev runs) keep the in-place handle; for
`Deb`/`Rpm` return the GitHub fallback `UpdateInfo` with `updater: null` and
a `manualOnlyReason` the dialog renders as a "download the new package"
call-to-action instead of "Update Now". The dialog's primary button becomes
"Download Update" in that mode (same opener path as today's manual link).

*Why a command instead of JS env sniffing?* `bundle_type()` is exactly the
signal the updater itself uses (it feeds `installer_for_bundle_type`); env
vars like `APPIMAGE` are not visible to the WebView JS without a command
anyway.

### D6: Error surfacing
`UpdateAvailableDialog.handleUpdateNow` catch normalizes the rejection
(`err instanceof Error ? err.message : typeof err === "string" ? err :
JSON.stringify(err)`), logs `console.error("[UpdateAvailableDialog] in-place
update failed:", err)`, and renders the normalized text above the existing
manual-download fallback. `relaunchApp` failures already log; keep.

## Risks / Trade-offs

- [Node verifier drift from Rust `minisign-verify`] → Unit tests embed the
  real v2.6.0 (valid) and v2.6.1 (invalid) signature fixtures and a
  generated known-good/known-bad pair; any semantics change in either
  implementation breaks the suite loudly. `npm run test:scripts` gate.
- [`verify-release` downloads ~1 GB of assets per release] → Runs
  concurrently with nothing time-critical (post-manifest), adds ~2–4 min;
  acceptable for the guarantee. Bandwidth is free on GitHub runners.
- [Required Windows platform fails releases while Windows is being repaired]
  → Intended: the requirement is Windows parity. Escape hatches: fix forward
  (the in-flight DLL fixes), or `windows_only: false` full re-dispatch with
  `build_ref` once fixed. Document in the release readiness summary.
- [Linux `bundle_type()` is compile-time patched — an AppImage run from a
  deb-built binary reports Deb?] → Not possible in practice: AppImages ship
  the AppImage-patched binary. Unknown (dev) defaults to offering in-place,
  which preserves current behavior.
- [Concurrent edits in the working tree] → The in-flight changes are
  incorporated as tasks (marked as such), not reimplemented; implementation
  must not revert them.

## Migration Plan

1. Land script fixes (tar resolution, DLL set, verify script) — safe
   independently of workflow changes.
2. Land workflow changes (gates, required Windows, verify-release job) with
   the next patch release; watch the release run end-to-end.
3. Backfill Windows for the currently-latest release (v2.6.1) via the
   `windows_only` dispatch once the Windows job is green, then re-dispatch
   the manifest job path so `latest.json` gains `windows-x86_64`. Note: the
   v2.6.1 Linux AppImage signature is broken and unfixable without
   rebuilding the artifact — the practical remedy is cutting the next patch
   release with these gates (existing 2.6.0 users updating will fail
   signature check on 2.6.1's AppImage; the next good release supersedes
   `latest.json`).
4. Rollback: revert the workflow commit; verification steps are additive and
   no shipped-app code depends on them (frontend changes are independent).

## Open Questions

- Should the `verify-release` job also assert asset digests against the
  GitHub API records (cheap, catches upload corruption)? Leaning yes; same
  script, `--check-digest` flag. (Default: include.)
- Should a failed `verify-release` auto-delete/rebuild the broken asset?
  No — out of scope; a red run plus human re-dispatch is the operating
  model for now.
