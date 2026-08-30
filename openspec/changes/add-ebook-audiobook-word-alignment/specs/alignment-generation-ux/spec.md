## ADDED Requirements

### Requirement: Alignment generation workflow

The system SHALL provide a user-initiated alignment workflow with human-readable progress states.

#### Scenario: Start alignment

- **WHEN** the user chooses "Sync text and audio" for a paired book
- **THEN** progress shows stages such as preparing, transcribing (if needed), aligning per chapter, and complete

#### Scenario: Cancel alignment

- **WHEN** the user cancels during alignment
- **THEN** in-progress work stops and any completed chapters remain saved

### Requirement: Error reporting

The system SHALL report alignment failures per chapter with actionable messages.

#### Scenario: Missing transcript

- **WHEN** no transcript exists for the audiobook
- **THEN** the UI prompts the user to transcribe before aligning

#### Scenario: Chapter alignment failure

- **WHEN** a single chapter fails to align
- **THEN** other chapters still complete and the failed chapter is listed for retry

### Requirement: Mobile consumption boundary

Mobile clients SHALL consume precomputed alignment maps but MAY defer alignment generation to desktop.

#### Scenario: Mobile open paired book

- **WHEN** a mobile user opens sync view without a local alignment map
- **THEN** the UI explains that alignment can be generated on desktop and offers segment-level fallback if a transcript exists
