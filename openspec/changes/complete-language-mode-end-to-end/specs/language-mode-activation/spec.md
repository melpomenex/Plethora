## ADDED Requirements

### Requirement: Profile creation remains explicit
The system SHALL allow creating language profiles in Settings without enabling Language Mode for any source.

#### Scenario: User creates a profile in Settings
- **WHEN** a learner creates a Spanish profile in Language Learning settings
- **THEN** no document association SHALL be created automatically

### Requirement: Active profile does not imply source association
The system SHALL treat active profile selection as scope-level preference only. Host resolution SHALL require an `enabled` association or explicit override.

#### Scenario: Active profile without association
- **WHEN** a learner activates a Spanish profile and opens a document with Language Mode enabled but no association
- **THEN** the host status SHALL be `unavailable` until the learner confirms an association

### Requirement: Association prompt in reader hosts
When Language Mode is enabled and no association exists, the reader host SHALL show an explicit association prompt listing active profiles.

#### Scenario: Learner confirms association
- **WHEN** the learner selects "Study as Spanish" in the association prompt
- **THEN** the system SHALL create an `enabled` association and re-resolve the host to `ready`

### Requirement: Detection suggestion banner
When detection evidence is available and Language Mode is enabled, the reader host SHALL mount the suggestion banner offering reversible association.

#### Scenario: Learner accepts suggestion
- **WHEN** the learner accepts the "Study this as Spanish?" banner
- **THEN** the system SHALL create an `enabled` association without mutating source content

### Requirement: Per-source disable
Users SHALL be able to dismiss suggestions with disable-for-content, storing `disabled` association mode.

#### Scenario: Learner disables language for content
- **WHEN** the learner chooses "Disable for this content"
- **THEN** the association mode SHALL be `disabled` and suggestions SHALL not reappear for that source
