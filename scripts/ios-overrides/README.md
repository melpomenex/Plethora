# iOS overrides data files (cross-proposal contract)

Data files consumed by `scripts/apply-ios-project-overrides.js` to modify the
generated iOS project (`src-tauri/gen/apple`, committed per
`docs/release/ios-generated-project.md`). **Never hand-edit `gen/apple`** —
author JSON here and re-run the script.

## `privacy-manifest.json` (Proposal C)

```json
{
  "privacyManifestSourcePath": "src/lib/privacy/PrivacyInfo.xcprivacy",
  "purposeStrings": { "NSSomeUsageDescription": "…" }
}
```

## `share-extension.target.json` (Proposal E — iOS Share Extension)

| Key | Meaning |
|---|---|
| `targetName` | Unique xcodegen target name (currently `plethora-share-extension`). It must not collide with the host app target. |
| `displayName` | Extension `CFBundleDisplayName` shown in the share sheet (currently `Plethora`). |
| `bundleIdSuffix` | Bundle id = `com.plethora.app.<suffix>` → `com.plethora.app.ShareExtension`. |
| `appGroup` | App Group id. Added to BOTH the extension entitlements and the **main app target's** entitlements by the overrides script (E's §4.3 flows through this same field — there is no separate main-target entitlements file). |
| `deploymentTarget` | `IPHONEOS_DEPLOYMENT_TARGET` for the extension target. |
| `infoPlist.NSExtension` | Merged verbatim into the generated extension `Info.plist` (`NSExtensionPointIdentifier`, `NSExtensionPrincipalClass`, activation rule). |
| `entitlements` | Extension entitlements dict (App Group). |
| `sourceFiles` | xcodegen source path, relative to `gen/apple` — points at the checked-in Swift sources under `src-tauri/share-extension/Sources`. |

Documentation-only keys (`_contract`, `sizeLimitsDocumentationOnly`) are
ignored by the consumer.

### Swift sources

`src-tauri/share-extension/Sources/`:

- `ShareViewController.swift` — principal class (`@objc(PlethoraShareViewController)`),
  minimal save-confirmation UI, no extraction/network work.
- `ShareStagingWriter.swift` — App Group staging: `shares/.staging/<uuid>/` →
  atomic rename → `shares/.ready/<uuid>/` with `manifest.json` (schema in
  `src/types/share.ts`, reader in
  `src-tauri/plugins/plethora-folder-import/src/staged_shares.rs`).

### Cross-file invariants (keep in sync)

- `appGroup` here == `ShareStagingWriter.appGroupId` == Rust `APP_GROUP_ID`
  (`src-tauri/plugins/plethora-folder-import/src/lib.rs`).
- Manifest JSON schema here (via the writer) == `StagedShareManifest`
  (`src/types/share.ts`) == `staged_shares::StagedManifest`.
