# iOS Generated Xcode Project — Commit vs Regenerate Policy

Status: implemented (Change A, `complete-production-ios-build-and-signing-pipeline` §2).
Last verified: 2026-08-21.

## Policy

`src-tauri/gen/apple` is **committed to git**, mirroring the existing
`src-tauri/gen/android` precedent:

- **Committed:** `project.yml`, `plethora-tauri.xcodeproj/`, `Sources/`,
  `Assets.xcassets/`, `Info.plist`, entitlements, `ExportOptions.plist`,
  `Podfile`, `LaunchScreen.storyboard`.
- **Ignored (`.gitignore`):** `build/`, `Externals/`, `Pods/`, `xcuserdata/`,
  and `secrets/` (local signing material, never committed).

Rationale: ephemeral generation (the previous CI behavior) is unreviewable,
non-reproducible, and incompatible with extension targets (Proposal E) and
entitlements (Proposal C), which need a stable project to diff against.

## Regeneration procedure

```bash
rm -rf src-tauri/gen/apple
npm run tauri:ios:init            # tauri ios init --ci
node scripts/apply-ios-project-overrides.js
```

The overrides script re-applies every deliberate modification on top of the
freshly generated project. It is **idempotent** — running it twice reaches a
fixpoint (second run reports "nothing to do"), verified by
`scripts/__tests__/applyIosProjectOverrides.test.mjs`.

## What the overrides script applies

All xcodeproj modifications MUST flow through
`scripts/apply-ios-project-overrides.js`. Never hand-edit
`project.pbxproj` XML.

- Display name `Plethora`; bundle identifier `com.plethora.app` (verified,
  script fails loudly if the generator drifts)
- iPhone + iPad device families (`TARGETED_DEVICE_FAMILY: "1,2"`)
- Deployment target iOS 14.0
- Icon asset catalog sync from `src-tauri/icons/ios/AppIcon-*.png`
- Marketing version (`CFBundleShortVersionString` / `CFBundleVersion`) kept in
  lockstep with `src-tauri/tauri.conf.json`
- Minimal entitlements (no unneeded capabilities)
- TODO-C / TODO-E placeholder markers for downstream proposals

## Data-file hooks for parallel proposals

Other proposals must NOT edit `gen/apple` directly. They author JSON data
files under `scripts/ios-overrides/` that this script consumes when present;
when absent, clearly-marked placeholders remain in the generated project.

### Proposal C — `scripts/ios-overrides/privacy-manifest.json`

```json
{
  "privacyManifestSourcePath": "path/to/PrivacyInfo.xcprivacy",
  "purposeStrings": { "<Info.plist key>": "<string>" }
}
```

Copies the privacy manifest into the app target and injects purpose strings
into `Info.plist`, replacing the `TODO-C(privacy-manifest)` placeholder.

### Proposal E — `scripts/ios-overrides/share-extension.target.json`

```json
{
  "targetName": "plethora-share-extension",
  "bundleIdSuffix": "share",
  "appGroup": "group.com.plethora.app.shared",
  "deploymentTarget": "14.0",
  "infoPlist": { "NSExtension": { "...": "..." } },
  "entitlements": { "com.apple.security.application-groups": ["..."] },
  "sourceFiles": "plethora-share-extension/Sources"
}
```

Adds the App Group to the main app's entitlements, writes the extension
target's `Info.plist` + entitlements, and appends a marker-delimited xcodegen
target stanza to `project.yml`, replacing the `TODO-E(share-extension)`
placeholder.

## Verification status

- [x] Project generated via `tauri ios init --ci` and committed (sources only)
- [x] Overrides script idempotency proven by unit tests and double-run
- [x] Plist outputs pass `plutil -lint`
- [ ] Clean-regeneration build proof (`init` → overrides → xcodebuild)
      **pending**: this machine has no full Xcode install (only Command Line
      Tools; no `iphoneos` SDK), so `xcodegen`/`xcodebuild` verification of the
      regenerated project could not be executed here. The generation itself
      succeeded and all outputs are committed.
