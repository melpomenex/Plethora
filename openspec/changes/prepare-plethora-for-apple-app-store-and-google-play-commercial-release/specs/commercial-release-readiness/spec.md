## ADDED Requirements

### Requirement: Store build variants isolate policy-sensitive behavior
Builds SHALL carry a store/sideload variant flag: store variants SHALL exclude APK self-update paths and `REQUEST_INSTALL_PACKAGES` (statically verifiable), while sideload variants retain current capabilities. Platform-specific surface gating (e.g. external checkout links on iOS) SHALL be configuration-driven and documented.

#### Scenario: Store build lacks self-updater
- **WHEN** a Play-flavored build is scanned for self-update code and the install permission
- **THEN** neither is present and the static assertion passes

### Requirement: Signing uses store-grade key management
Android SHALL use Play App Signing with a new upload keystore stored only in CI secrets (the previously committed keystore is retired and rotated); iOS signing SHALL use App Store Connect API-key-based CI secrets. No signing material SHALL be committed (CI secret scan).

#### Scenario: No committed keystores
- **WHEN** the repository is scanned for keystore/signing material
- **THEN** none is found and builds sign from secret storage

### Requirement: Privacy declarations trace to the data map
Store privacy labels (App Store) and Data Safety forms (Play) SHALL be generated from the same machine-readable data map that powers in-app disclosures (proposal 22), with a traceability test that fails when they diverge.

#### Scenario: Labels match disclosures
- **WHEN** the data map changes a feature's data-flow classification
- **THEN** the label-generation output and in-app privacy center reflect it and the traceability test passes

### Requirement: Account deletion and restore are store-compliant
In-app account deletion (proposal 22) SHALL be reachable from within the app on mobile builds; purchase restore SHALL function on fresh installs with sandbox evidence recorded per platform.

#### Scenario: Reviewer can delete an account
- **WHEN** a reviewer follows the in-app deletion flow on a store build
- **THEN** it completes with cloud removal and default local preservation as specified

### Requirement: The mobile regression program is scripted and repeatable
A device-matrix smoke suite SHALL cover launch, import, reading, extraction, review, TTS, offline airplane-mode behavior, share-sheet in/out, sandbox purchase/restore, and deletion; lifecycle tests SHALL verify backgrounding/resume during active jobs. Evidence SHALL be recorded per run.

#### Scenario: Offline pass
- **WHEN** the airplane-mode scenario runs on device
- **THEN** local reading/review/TTS-cached playback function and cloud features degrade with reasons

### Requirement: Policy verification is current, not remembered
The policy audit (updaters, IAP, external links, media ingestion, browser usage, permissions justifications) SHALL re-verify against live store documentation at implementation time; findings and decisions SHALL be recorded with dates in the release checklist.

#### Scenario: Audit is dated
- **WHEN** the release checklist is reviewed
- **THEN** each policy item cites the verification date and outcome

### Requirement: Submission readiness is checklist-gated
A documented release checklist (per-store steps, rejection-risk items, sign-off) SHALL gate submission; versionCode/version management SHALL integrate with the existing release automation across all five manifests.

#### Scenario: Checklist blocks premature submission
- **WHEN** any checklist item is unsigned
- **THEN** the release process reports not-ready
