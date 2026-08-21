# iOS Signing Protocol

Change A (`complete-production-ios-build-and-signing-pipeline`) §4.1/§5.4.
Mirrors the Android precedent (`gen/android/app/keystore.properties` +
committed `keystore.properties.example`): real signing data lives in a
gitignored local directory; only a sanitized template is committed.

## Local (developer machine)

1. Copy the template:

   ```sh
   cp src-tauri/gen/apple/secrets/exportOptions.plist.example \
      src-tauri/gen/apple/secrets/exportOptions.plist
   ```

2. Fill in `teamID` and the provisioning-profile names/UUIDs for **both**
   signed bundle ids — `com.plethora.app` (app) and
   `com.plethora.app.ShareExtension` (Change E target ships inside the same
   archive).

3. Run the pipeline:

   ```sh
   npm run tauri:ios:preflight   # tool + secret availability check
   npm run tauri:ios:archive     # tauri ios build → .xcarchive (store profile)
   npm run tauri:ios:export      # xcodebuild -exportArchive → .ipa
   npm run tauri:ios:validate    # xcrun altool --validate-app (ASC API key)
   npm run tauri:ios:upload      # xcrun altool --upload-app  (ASC API key)
   ```

Missing prerequisites fail fast with the exact list of what is absent — no
half-signed output. `src-tauri/gen/apple/secrets/` is gitignored except
`*.example` templates (see `.gitignore`). Never commit certificates,
profiles, API keys, or a filled-in exportOptions.plist.

### App Store Connect API key (validate + upload)

Create once in App Store Connect → Users and Access → Integrations →
App Store Connect API (role: App Manager or Developer):

| Env var              | Meaning                                   |
|----------------------|-------------------------------------------|
| `ASC_KEY_ID`         | The key's ID                              |
| `ASC_ISSUER_ID`      | The issuer ID shown above the keys table  |
| `ASC_KEY_PDF_BASE64` | `base64 -i AuthKey_<KEY_ID>.p8 \| pbcopy` |

(The third variable's name is historical contract surface; the content is the
`.p8` private key.) `scripts/ios-release.mjs` materializes the key at
`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` (override the directory
with `ASC_KEY_DIR`) where `xcrun` tools find it automatically.

## Upload CLI choice (and why)

Apple deprecated `altool` for **macOS notarization** in favor of
`notarytool`; `notarytool` does not handle App Store/TestFlight uploads. For
submitting an exported `.ipa`, the first-party options are Xcode Organizer,
the Transporter app, and `xcrun altool --validate-app/--upload-app`
authenticated with an ASC API key. We use **altool** because it is the only
first-party CLI that performs standalone *validation* and standalone *upload*
of an existing `.ipa`, which keeps our pipeline stages symmetric
(validate must pass before upload runs). If Apple removes altool, only the
command builders in `scripts/ios-release.mjs` need to change.

## CI (GitHub Actions, `.github/workflows/mobile-build.yml`)

| Secret                       | Purpose                                                        |
|------------------------------|----------------------------------------------------------------|
| `IOS_CERT_BASE64`            | Apple Distribution certificate (.p12), base64                  |
| `IOS_CERT_PASSWORD`          | Password of that .p12                                          |
| `IOS_PROFILE_BASE64`         | App Store profile for `com.plethora.app`, base64               |
| `IOS_SHARE_PROFILE_BASE64`   | Optional profile for `com.plethora.app.ShareExtension`, base64 |
| `IOS_SIGNING_IDENTITY`       | e.g. `Apple Distribution: Example Corp (TEAMID)`               |
| `IOS_TEAM_ID`                | Apple Developer team ID                                        |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_PDF_BASE64` | TestFlight validation + upload        |

Behavior matrix (task 5.1/5.2):

- **All cert/profile secrets present** → signed archive + export + altool
  validation. Artifacts: `ios-archive`, `ios-ipa`, `ios-validation-logs`.
- **Secrets absent** → simulator build, allowed **only on non-release refs**;
  `v*` tag builds fail hard instead of producing an unsigned artifact.
- **ASC secrets present AND (`v*` tag OR dispatch input
  `upload_testflight=true`)** → upload to TestFlight, but only after
  validation succeeded; validation failure skips upload and reddens the job.

CI generates its own exportOptions plist at `$RUNNER_TEMP` from these secrets
(same shape as the committed example) — nothing secret is written into the
repo or artifacts. No secret values are ever printed; logs contain tool
output only.

## Build numbers

`CURRENT_PROJECT_VERSION` is a monotonic integer maintained by
`scripts/release.cjs` via the committed counter file
`src-tauri/gen/apple/build-number.txt`; see
[docs/release/ios-reproducible-build.md](./ios-reproducible-build.md) for the
scheme.
