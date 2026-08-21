## ADDED Requirements

### Requirement: Launch-blocking claims SHALL require recorded evidence
No iOS launch-blocking item SHALL be considered complete based on code existence or task checkboxes alone. Each SHALL map to a verification-ladder level and carry a durable evidence reference (run record, CI run id, build number, or validation output) stored in the repository evidence location without secrets or personal data.

#### Scenario: Checkbox without evidence is rejected
- **WHEN** a release-gate item is marked complete without an evidence reference
- **THEN** the gate linter fails the declaration

### Requirement: A golden-path scenario suite SHALL be defined and executed on physical devices against TestFlight builds
The golden path (install → import → read → position restore → extract → review → offline → sync → sandbox purchase → entitlement persistence → restore → account deletion → post-deletion rejection) SHALL be executed on physical iPhone hardware against a TestFlight-distributed build, with iPad coverage where iPad is supported, and per-format variations recorded.

#### Scenario: Golden path passes on TestFlight build
- **WHEN** the release gate is evaluated for an RC
- **THEN** a run record exists for the golden path executed on physical hardware against the exact TestFlight build number, with every scenario pass or explicitly dispositioned

### Requirement: Lifecycle and accessibility scenarios SHALL be verified
Foreground/background transitions, screen lock, rotation, connectivity loss, offline launch, denied permissions, large libraries, Dynamic Type, VoiceOver smoke, Reduce Motion, and light/dark rendering SHALL be exercised and recorded for the RC build.

#### Scenario: Offline relaunch
- **WHEN** the app is relaunched in airplane mode with an existing library
- **THEN** documents open, reading position is restored, and review functions, with the run recorded

### Requirement: Evidence SHALL be durable, sanitized, and reviewable
Run records SHALL be stored in a repository-defined location in a validated schema, contain build/device/provenance metadata, exclude secrets and personal information, and be sufficient for an outside reviewer to reconstruct what was verified, on what hardware, against which build.

#### Scenario: Outside reviewer audit
- **WHEN** a reviewer reads the evidence directory for the RC
- **THEN** they can trace every gate item to a run record with device model, iOS version, and build number

### Requirement: The submission gate SHALL aggregate all P0 dispositions
A maintained release-gate checklist SHALL enumerate every launch-critical requirement across proposals; submission readiness SHALL be declared only when every line carries evidence or an explicit, rationale-backed disposition.

#### Scenario: Gate declaration
- **WHEN** the team declares App Store submission readiness
- **THEN** the checklist shows no open P0 blockers and every P1/P2 remainder has a recorded disposition
