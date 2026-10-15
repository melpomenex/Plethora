## ADDED Requirements

### Requirement: Every desktop release publishes complete updater artifacts
A tagged release of the desktop app SHALL publish, for each supported desktop
platform — `darwin-aarch64` (`.app.tar.gz` + `.sig`), `linux-x86_64`
(`.AppImage` + `.sig`), and `windows-x86_64` (`-setup.exe` + `.exe.sig`) — the
updater bundle and its signature file as release assets. A release workflow
run that fails to produce any one of these artifacts SHALL fail the release
job loudly rather than silently omit the platform from the update manifest.

#### Scenario: Windows build fails
- **WHEN** the `release (windows-x86_64)` job fails to build or verify its
  NSIS bundle
- **THEN** the release workflow run is marked failed and the update-manifest
  job refuses to publish a `latest.json` without a `windows-x86_64` entry

#### Scenario: All platforms build
- **WHEN** a tagged release completes with all desktop platform jobs
  succeeding
- **THEN** the release assets include the six updater files and `latest.json`
  contains entries for `darwin-aarch64`, `linux-x86_64`, and `windows-x86_64`
  whose URLs resolve (HTTP 200 following redirects) to those assets

### Requirement: Updater signatures are verified before and after publication
The release pipeline SHALL cryptographically verify each updater artifact's
signature against the artifact bytes using the updater public key from
`tauri.conf.json`, with the same minisign semantics the running app's updater
uses (blake2b512 prehash + Ed25519 over the whole signature box, trusted
comment included). This SHALL happen (a) after any artifact is signed
outside the bundler — i.e. after the AppImage repack re-sign — and before it
is uploaded, and (b) after publication, by downloading the released
`latest.json` and each referenced artifact and verifying the manifest's
`signature` field against the downloaded bytes.

#### Scenario: Signature does not match uploaded bytes
- **WHEN** an artifact is signed but the uploaded asset's bytes differ from
  the signed bytes (the v2.6.1 AppImage failure)
- **THEN** the post-sign verification or post-publication verification step
  fails the release job, and no manifest referencing a broken signature is
  left as the latest release

#### Scenario: Post-publication check passes
- **WHEN** the released `latest.json` and all referenced artifacts are
  re-downloaded and verified after publication
- **THEN** every platform entry's signature verifies against its downloaded
  artifact and the verification job succeeds

### Requirement: Update manifest generation validates platform completeness
The update-manifest job SHALL treat `darwin-aarch64`, `linux-x86_64`, and
`windows-x86_64` as required platforms: if any required platform's bundle or
signature asset is missing or empty, the job SHALL fail instead of publishing
an incomplete manifest. Backfill dispatches that intentionally skip manifest
regeneration (`windows_only` mode) SHALL leave the existing `latest.json`
byte-identical.

#### Scenario: Windows assets missing on a full release
- **WHEN** the manifest job runs for a full release and the
  `Incrementum_<version>_x64-setup.exe` asset or its `.sig` is absent
- **THEN** the job fails with a message naming the missing artifact

#### Scenario: Windows-only backfill
- **WHEN** the release workflow is dispatched with `windows_only: true`
- **THEN** only the Windows job runs, its assets attach to the existing
  release, and `latest.json` is not regenerated

### Requirement: Windows release verification runs on Windows runners
Release-time bundle verification scripts SHALL execute successfully on
`windows-latest` runners: any external tool invocation (e.g. `tar` for test
fixture extraction) SHALL resolve the executable explicitly (absolute
`%SystemRoot%\System32\` path with fallback) rather than relying on
`PATH`-based lookup through Node's `spawnSync`, and bundle content checks
SHALL verify the real `onnxruntime.dll` (not only the
`onnxruntime_providers_shared.dll` shim) is packed.

#### Scenario: Transcription smoke test extracts a tar fixture
- **WHEN** `verify-transcription-sidecars.mjs` extracts the sherpa test-model
  tarball on a Windows runner
- **THEN** the tar executable is resolved via the system path (e.g.
  `C:\Windows\System32\tar.exe`) and extraction succeeds

#### Scenario: NSIS bundle ships only the ONNX shim DLL
- **WHEN** the NSIS installer archive contains
  `bin/onnxruntime_providers_shared.dll` but not `bin/onnxruntime.dll`
- **THEN** the Windows bundle verification step fails with an error naming the
  missing DLL

### Requirement: In-place install is offered only where the install method supports it
The update UI SHALL offer an in-place install when the running app's platform
and bundle type support it: macOS app bundles, Windows NSIS installs, and
Linux AppImage installs. On Linux systems-package installs (deb/rpm), the UI
SHALL NOT offer the in-place path (which would attempt to overwrite a
root-owned `/usr/bin` binary); it SHALL instead present the release download
for the matching system package.

#### Scenario: AppImage Linux user updates
- **WHEN** a Linux user running an AppImage install checks for updates and a
  newer version is available
- **THEN** "Update Now" performs the signed in-place update and relaunches

#### Scenario: deb Linux user updates
- **WHEN** a Linux user running a deb install checks for updates and a newer
  version is available
- **THEN** the dialog offers downloading the new release instead of in-place
  installation, and no in-place install is attempted

### Requirement: Update failures surface the underlying error
When an in-place update fails, the update dialog SHALL display the updater's
actual error string (from a rejected `Error`, string, or object rejection) in
addition to the manual-download fallback, and SHALL log it to the console with
a stable prefix.

#### Scenario: Signature verification failure
- **WHEN** the updater rejects with a signature error during
  `downloadAndInstall`
- **THEN** the dialog shows the updater's error text (not only the generic
  fallback) and the console log includes the rejection value

#### Scenario: Non-Error rejection
- **WHEN** the updater rejects with a plain string (Tauri command error)
- **THEN** the dialog renders that string as the failure message
