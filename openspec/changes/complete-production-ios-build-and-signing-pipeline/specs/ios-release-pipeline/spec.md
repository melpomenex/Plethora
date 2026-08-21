## ADDED Requirements

### Requirement: iOS native plugins SHALL link and register
Every Tauri plugin with an `ios/` Swift package SHALL export a `@_cdecl` symbol identical to the symbol declared by its Rust `tauri::ios_plugin_binding!` macro, and its SwiftPM package/target/product names SHALL match the crate name declared in the plugin's Cargo.toml. A repository guard MUST fail CI when any plugin violates this.

#### Scenario: Folder-import plugin registers on iOS
- **WHEN** the iOS app initializes the folder-import plugin on a device or simulator
- **THEN** `register_ios_plugin(init_plugin_plethora_folder_import)` resolves against a matching exported symbol and the plugin's commands are invocable from the frontend

#### Scenario: Stale branding symbols are rejected
- **WHEN** any plugin source contains an `@_cdecl`, SwiftPM package name, or `ios_plugin_binding!` identifier referencing `incrementum`
- **THEN** the automated naming guard fails the build with the offending file listed

### Requirement: A reproducible signed Release build path SHALL exist
A developer with repository secrets SHALL produce, from a clean checkout, a signed Release `.xcarchive` for `aarch64-apple-ios` using documented commands, and the generated `src-tauri/gen/apple` project SHALL be reproducible via `tauri ios init --ci` plus an idempotent overrides script.

#### Scenario: Clean-checkout device build
- **WHEN** a developer clones the repo, supplies local signing material per documentation, and runs the documented archive commands
- **THEN** a signed `.ipa` is produced without manual xcodeproj edits

#### Scenario: Regeneration preserves configuration
- **WHEN** `gen/apple` is deleted and regenerated, then the overrides script is applied
- **THEN** bundle identity, Info.plist keys, entitlements, icons, and version settings match the committed project state

### Requirement: The store build profile SHALL structurally exclude forbidden capabilities
When built with the `store` profile, the iOS application MUST NOT register the desktop updater, MUST NOT activate mock billing as the billing backend, MUST NOT reference development endpoints, and MUST NOT include desktop sidecar binaries or resources. Violations MUST fail the build via automated checks rather than rely on runtime hiding.

#### Scenario: Updater cannot ship in a store build
- **WHEN** an iOS store-profile build is produced
- **THEN** automated invariant tests confirm the updater plugin is unregistered and self-update surfaces are compiled out or unreachable

#### Scenario: Sidecars never leak into iOS
- **WHEN** the iOS bundle configuration is evaluated at build time
- **THEN** `bundle.externalBin` and `bundle.resources` are empty and the test enforcing this passes

### Requirement: Archive validation SHALL precede distribution
Every Release `.ipa` intended for TestFlight or App Store distribution SHALL pass Apple's archive validation before upload, and validation failures MUST block upload.

#### Scenario: Invalid archive is not uploaded
- **WHEN** archive validation reports errors for a produced `.ipa`
- **THEN** the pipeline stops, retains logs as evidence, and no upload occurs

### Requirement: Versioning SHALL be automated and consistent
The release tooling SHALL derive iOS marketing version and build number from the single-source release version, and regenerated projects SHALL receive identical values via the overrides script.

#### Scenario: Release bump updates iOS metadata
- **WHEN** `scripts/release.cjs` bumps the app to a new semver
- **THEN** the iOS project override outputs the new marketing version and an incremented monotonic build number without manual edits

### Requirement: CI SHALL distinguish proven build modes
CI iOS jobs SHALL clearly label their output mode (signed device archive, unsigned simulator), tag-triggered builds SHALL require signed mode, and every successful pipeline run SHALL retain machine-readable logs of each stage.

#### Scenario: Tag build without secrets fails loudly
- **WHEN** a release-tag build runs without signing secrets configured
- **THEN** the job fails with an explicit missing-secret message instead of silently producing a simulator artifact

### Requirement: Documentation claims SHALL match verified reality
Release documentation SHALL describe only paths that have been executed successfully, and stale completion claims in prior OpenSpec task documents about iOS signing/TestFlight SHALL be annotated as superseded by this capability.

#### Scenario: Stale checkbox corrected
- **WHEN** a reader consults prior App Store readiness tasks claiming ASC API-key signing and TestFlight dry runs were complete
- **THEN** those items carry an annotation pointing to this change as the actual implementation with recorded evidence
