## Why

Plethora 3.3.0's Windows installer ships an application manifest whose `<msix>` element is written in the *package* (AppxManifest) form — `<publisherIdentity>` / `<packageIdentity>` child elements — while the Windows loader requires the *application* manifest form: three attributes on a childless element. The Side-by-Side activation context generator rejects the whole manifest (`ERROR_SXS_CANT_GEN_ACTCTX` / 14001, `SideBySide` event ID 62, line 1) before `main()` runs, so `plethora-tauri.exe` cannot start at all on any Windows machine (Issue #4, blocker for the 3.3.0 Windows installer). `src-tauri/build.rs` embeds the same manifest into every binary of the crate, so `pdf-reflow-diag.exe` fails identically — one shared defect, two dead executables.

The rest of the identity plumbing is equally untruthful: identity metadata is frozen at `2.7.0.0` while the app is `3.3.0` (the PE version resource comes from `tauri.conf.json`, the identity does not); the NSIS installer never registers the identity package the manifest declares, so even a corrected manifest would reference a package that does not exist on the machine; and no release step validates an embedded manifest, which is why an unlaunchable build reached users.

## What Changes

- **Fix the manifest schema (the blocker).** Rewrite `<msix>` in `src-tauri/windows/app.manifest` as a childless element carrying `packageName`, `publisher`, and `applicationId`, matching the identity package. Both `plethora-tauri.exe` and `pdf-reflow-diag.exe` must launch on a clean Windows 11 install and reach `main()` — with and without the identity package registered.
- **Single-source identity metadata.** `src-tauri/tauri.conf.json` `version` drives the app manifest identity version, the sparse `AppxManifest` `Identity/@Version`, and (already) the PE version resource. A check script fails fast on drift, so the identity package version can no longer be pinned to an old hard-coded value — the same monotonicity that future package updates depend on.
- **Register identity at install time.** Configure NSIS installer hooks to register the signed sparse identity package per-user with `ExternalLocation` set to the install directory, and to remove it on uninstall. Registration failure must never fail the install or block app launch, and the installer must never install an untrusted certificate as a trust anchor.
- **Repair the runtime self-heal path.** `sparse_package.rs` currently calls a non-existent `AddPackageOptions` type name from PowerShell and cannot await WinRT async; switch it to the documented `Add-AppxPackage -Path … -ExternalLocation …` surface and surface the registration error code in diagnostics instead of a generic failure string.
- **Gate the release on artifact truth.** Extract the embedded manifest from each shipped Windows executable and validate it (schema conformance plus identity-value equality with the built `PlethoraIdentity.msix`), and smoke-launch the installed executables so an unlaunchable build cannot be published again.
- **Correct the troubleshooting story.** Document that reinstalling the Visual C++ Redistributable cannot fix a side-by-side manifest failure, what the `SideBySide` event ID 62 messages mean, and how to check identity state in **Settings → On-device AI → Diagnostics**.

## Capabilities

### New Capabilities

- `windows-package-identity`: schema-valid embedded application manifests for every shipped Windows executable, identity metadata derived from a single version source, install-scoped registration of the sparse identity package, and release-gate verification that no Windows artifact ships with an unlaunchable or unverifiable manifest.

### Modified Capabilities

- `native-ai-routing`: identity-dependent Windows AI features must degrade to `package_identity_missing` without blocking launch, and the identity acquisition path must report the OS registration result (including extended error code) rather than an opaque failure.

## Impact

- **Fixed:** `src-tauri/windows/app.manifest` (the defect), consumed by `src-tauri/build.rs` → `tauri_build::WindowsAttributes::app_manifest` → `tauri-winres`, whose `rustc-link-lib` output applies the manifest to *all* binaries of the crate (hence `pdf-reflow-diag`).
- **Touched:** `src-tauri/windows/sparse/Package.appxmanifest` and `src-tauri/windows/msix/Package.appxmanifest` (version + identity fields), `src-tauri/tauri.conf.json` (`bundle.windows.nsis` installer hooks), new `src-tauri/windows/installer-hooks.nsh`, `src-tauri/plugins/plethora-windows-intelligence/src/windows/sparse_package.rs`, `scripts/build-windows-sparse-package.ps1`, `scripts/verify-windows-bundles.ps1`, `.github/workflows/release.yml`, `docs/USER_HANDBOOK.md` (and its translations).
- **New scripts/tests:** a version-sync script with a `--check` mode (wired into `npm run test:scripts` so drift fails locally) and a Windows manifest-verification script used as a release gate.
- **Release prerequisites:** the shipping identity package must be signed by a certificate the target machine already trusts (today it is signed by the development certificate `CN=Plethora Sparse Dev`, which is not trusted anywhere); the installer only registers a package whose signing chain is trusted, so a production signing decision (for example Azure Trusted Signing) is required for identity-dependent features, not for launching.
- **Not affected:** frontend, database, sync, scheduler. No new runtime dependency, and no change to non-Windows bundles.
- **Verification needs a real Windows host/VM** (loader-level behaviour cannot be exercised on this Linux workstation); CI covers it through the release workflow's Windows leg.
