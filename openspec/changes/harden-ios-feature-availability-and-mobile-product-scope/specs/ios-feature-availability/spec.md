## ADDED Requirements

### Requirement: A centralized platform capability registry SHALL govern iOS surface availability
Every user-visible destination, command, and settings section SHALL be classifiable through the platform capability registry with an availability decision and reason. Unsupported features on iOS SHALL either be hidden (when absence adds no confusion) or presented as explicitly unavailable with an accurate explanation — never rendered as broken or dead controls.

#### Scenario: Android-only TTS hidden on iOS
- **WHEN** the TTS settings render on iOS
- **THEN** the Android on-device voice adapter is absent and cloud providers remain listed

#### Scenario: Desktop-only integration marked unavailable
- **WHEN** a user encounters a desktop-only capability that remains discoverable on iOS
- **THEN** it is presented as unavailable with a short accurate reason rather than failing at use

#### Scenario: Deep link to a hidden surface
- **WHEN** a stale link or internal navigation targets a surface hidden on iOS
- **THEN** the app lands on a sensible nearest surface without errors

### Requirement: Self-update surfaces SHALL NOT exist on iOS
The updater row, update checks, and any self-update UI MUST NOT render inside the iOS app, enforced by the registry rather than incidental conditionals.

#### Scenario: Settings on iOS shows no update check
- **WHEN** the general settings section renders on iOS
- **THEN** no check-for-updates control appears

### Requirement: Core workflow SHALL remain available
Import, Read, Extract, Remember (flashcard creation), and Review SHALL be registered as protected capabilities that remain available on iPhone and iPad, enforced by automated tests.

#### Scenario: Protected-surface regression
- **WHEN** a change modifies gating or navigation definitions
- **THEN** the protected-surface test fails if any core-workflow capability becomes unavailable on iOS

### Requirement: Desktop and Android behavior SHALL be preserved
Registry introduction and gating changes MUST NOT alter feature availability or behavior on desktop platforms or Android; snapshot tests SHALL enforce unchanged rendering.

#### Scenario: Desktop regression check
- **WHEN** the capability registry is introduced
- **THEN** desktop and Android snapshots of navigation, settings, and palettes are identical to pre-change baselines

### Requirement: The iOS capability matrix SHALL be generated and test-enforced
A maintained document SHALL describe every capability's iOS classification, generated from the registry, with automated consistency checks between registry, document, and navigation definitions.

#### Scenario: Registry drift detected
- **WHEN** a registry entry changes without a matching document regeneration
- **THEN** the consistency test fails
