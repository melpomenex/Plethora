# iOS Reproducible Build: Clean Checkout → TestFlight

Change A (`complete-production-ios-build-and-signing-pipeline`) §7.1.
Everything required to go from a fresh clone to a processed TestFlight build,
in order. Companion docs: [ios-signing.md](./ios-signing.md),
[ios-generated-project.md](./ios-generated-project.md).

Status honesty note (repo standard: implemented ≠ verified): steps marked
**[Xcode-gated]** require a machine with full Xcode + iOS platform SDK and
Apple-program credentials; they have NOT yet been executed for this repo
(see `openspec/changes/complete-production-ios-build-and-signing-pipeline/
evidence/a-tasks-4-7.md` for the verification-ladder record).

## 0. Manual Apple-side prerequisites (one-time)

1. Apple Developer Program membership (team ID = `IOS_TEAM_ID`).
2. An App Store Connect **app record** with bundle id `com.plethora.app`
   (created once in Identifiers → App IDs; enable Associated Domains only if
   actually used).
3. Distribution certificate: create an **Apple Distribution** certificate,
   export it as `.p12` (this becomes `IOS_CERT_BASE64` +
   `IOS_CERT_PASSWORD`).
4. Provisioning profiles (App Store method):
   - `com.plethora.app` → `IOS_PROFILE_BASE64`
   - `com.plethora.app.ShareExtension` → `IOS_SHARE_PROFILE_BASE64`
5. App Store Connect API key (Users and Access → Integrations):
   download `AuthKey_<KEY_ID>.p8` once; keep issuer ID. These become
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PDF_BASE64`.
6. TestFlight: the first upload creates the internal-testing build group.

## 1. Clean checkout + toolchain

```sh
git clone <repo> && cd Plethora
npm ci                       # frontend deps (incl. @tauri-apps/cli)
rustup toolchain install 1.89.0
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
xcodebuild -version          # requires FULL Xcode, not just CLT
pod --version                # cocoapods (brew install cocoapods) if missing
node scripts/ios-release.mjs preflight
```

`gen/apple` is committed, so no `tauri ios init` is needed on a clean
checkout. If it were ever missing: `npm run tauri:ios:init`, then
`node scripts/apply-ios-project-overrides.js` (idempotent; re-applies display
name, icons, privacy manifest/purpose strings, share-extension target).

## 2. Local signing material (never committed)

```sh
cp src-tauri/gen/apple/secrets/exportOptions.plist.example \
   src-tauri/gen/apple/secrets/exportOptions.plist
# fill in teamID + both profile names (see ios-signing.md)

export ASC_KEY_ID=...
export ASC_ISSUER_ID=...
export ASC_KEY_PDF_BASE64="$(base64 -i ~/Downloads/AuthKey_<KEY_ID>.p8)"
```

## 3. Build numbers

- Marketing version (`CFBundleShortVersionString`): bumped by
  `node scripts/release.cjs [<version>]` across package.json /
  tauri.conf.json / Cargo.toml / Cargo.lock in lockstep.
- `CURRENT_PROJECT_VERSION`: monotonic integer in the committed counter file
  `src-tauri/gen/apple/build-number.txt`. Every release run increments it by
  exactly one and writes it into project.yml + Info.plist via
  `scripts/apply-ios-project-overrides.js`. Because the counter is committed,
  every clean checkout computes the same next number.
- Extra TestFlight uploads between releases (hotfix re-uploads of the same
  marketing version) set `IOS_BUILD_NUMBER=<n>` explicitly; n must exceed the
  previous value. App Store Connect rejects reused build numbers, so when in
  doubt, increment.

## 4. Archive → export → validate → upload **[Xcode-gated]**

```sh
PLETHORA_BUILD_PROFILE=store npm run tauri:ios:archive
npm run tauri:ios:export       # uses secrets/exportOptions.plist
npm run tauri:ios:validate     # must pass before any upload
npm run tauri:ios:upload
```

Outputs land under `src-tauri/target/xcodebuild/` (`logs/` keeps the altool
and export logs). The archive step runs with the store build profile, which
hard-fails the frontend bundle if dev/test endpoints or forbidden artifacts
appear (task 6.1 invariants). Upload submits to TestFlight; track processing
in App Store Connect → TestFlight.

CI performs the identical pipeline from repository secrets
(`.github/workflows/mobile-build.yml`, `ios-build` job); tag builds must be
signed and upload to TestFlight when ASC secrets are present (dispatch input
`upload_testflight=true` forces it for non-tag runs).

## 5. Evidence-recording expectation

Every executed verification level is recorded in
`openspec/changes/complete-production-ios-build-and-signing-pipeline/evidence/`
(raw logs allowed; schema owned by Proposal G — artifact names currently
defined by Change A: `ios-archive`, `ios-ipa`, `ios-validation-logs`,
subject to G's final naming). A TestFlight run is not "done" until the build
appears and processes in App Store Connect; record the run ID / build number.

## 6. Verification ladder status (task 7.2)

See `openspec/changes/complete-production-ios-build-and-signing-pipeline/
evidence/a-tasks-4-7.md` for the dated, honest per-level status:
implemented / automated-tests-pass levels are green; simulator, physical
device, signed archive, validation, and TestFlight levels await an
Xcode-equipped runner.
