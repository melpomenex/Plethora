# Spec: language-profiles

## ADDED Requirements

### Requirement: Separate learner language from application locale

The system SHALL represent the application UI locale and each target learning language as distinct values. Changing one MUST NOT implicitly change the other.

#### Scenario: English UI with Spanish study
- **WHEN** the application locale is English and the active profile targets Spanish
- **THEN** UI strings remain English while language-aware readers use Spanish processing and the profile base language

#### Scenario: Multiple target languages
- **WHEN** a user has Spanish and Japanese profiles
- **THEN** both profiles remain available and switching the active profile does not overwrite the other profile's state

### Requirement: Profile persistence and fields

Each profile SHALL persist a stable ID, target BCP-47 language tag, base/explanation language tag, optional proficiency estimate, learner preferences, processing configuration, created/updated timestamps, and lifecycle state. Target and base language SHALL be validated independently.

#### Scenario: Create a profile
- **WHEN** the user creates Spanish with English explanations and optional B1 level
- **THEN** the profile is durable, reloadable, and exposes those values to language-aware services

### Requirement: Non-destructive content association

Documents and media SHALL support an association to a profile with `auto`, `enabled`, or `disabled` resolution and optional detected-language evidence. Association changes MUST NOT change source content, reading position, Queue scheduling, or generic annotations.

#### Scenario: Confirm detection
- **WHEN** imported content is detected as Spanish and the user chooses “Study as Spanish”
- **THEN** the content is associated with the selected Spanish profile and Language Mode may activate on the next reader mount

#### Scenario: Reject detection
- **WHEN** the user explicitly disables language learning for a detected Spanish document
- **THEN** language UI stays off for that content until the user explicitly re-enables it

### Requirement: Activation rules

Readers SHALL resolve Language Mode only from an explicit enable, an explicit per-item override, or a user-confirmed suggestion. A nullable active profile SHALL be supported, and ordinary documents SHALL remain ordinary when no profile is resolved.

#### Scenario: No profile
- **WHEN** a normal English document has no associated profile
- **THEN** it opens with existing reader behavior and no language-learning highlights or controls

### Requirement: Profile-scoped settings and state

Preferences such as highlight density, translation display, explanation behavior, and processing provider SHALL be stored per profile. Lexical and analytics state queried from a reader SHALL be keyed by profile ID.

#### Scenario: Same content under two profiles
- **WHEN** the same Spanish document is associated with two users' profiles or two profile contexts
- **THEN** each profile sees its own language state and preferences without cross-profile leakage

### Requirement: Offline and provider degradation

Profile creation, association, activation, manual settings, and existing lexical state SHALL work without network or AI providers. Detection and optional provider-backed processing MAY be unavailable and SHALL report a recoverable state.

#### Scenario: Offline profile activation
- **WHEN** the device is offline and a stored Spanish profile is selected
- **THEN** the reader can enter Language Mode using cached/local capabilities, while unavailable detection or translation is labeled unavailable

### Requirement: Deletion, archive, and migration safety

Deleting or archiving a profile SHALL require confirmation, detach or delete only profile-scoped derived data according to the selected action, preserve source documents and generic learning items, and leave no dangling associations. Existing documents with language metadata SHALL remain readable after migration.

#### Scenario: Delete profile with content
- **WHEN** the user deletes a profile associated with documents and vocabulary
- **THEN** the documents remain, their generic reading state remains, associations are cleared, and the user is told what profile-scoped data was removed or retained

### Requirement: Accessibility and cross-platform behavior

Profile selection and Language Mode activation SHALL be usable by mouse, keyboard, touch, screen reader, reduced-motion, and e-ink presentation modes. No language-specific control may be the only path to open or read content.

#### Scenario: Keyboard activation
- **WHEN** a keyboard-only user focuses the detected-language suggestion
- **THEN** they can confirm, dismiss, or disable it with labeled controls and no focus trap
