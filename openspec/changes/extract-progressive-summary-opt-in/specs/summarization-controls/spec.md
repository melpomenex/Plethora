## ADDED Requirements

### Requirement: Extract progressive-summary toggle

The system SHALL provide a setting named "Generate AI summaries for extracts during
review" in the AI settings, and it SHALL be disabled by default on fresh installs and on
profiles that never enabled it.

While disabled, the system SHALL NOT automatically request AI summaries for extracts
during review. While enabled, automatic summary generation SHALL be permitted only for
extracts whose maximum disclosure level is greater than zero. Enabling the setting SHALL
NOT retroactively generate summaries; it SHALL apply the next time an eligible extract is
opened.

#### Scenario: Default is disabled

- **WHEN** a user opens AI settings on a fresh install
- **THEN** the extract progressive-summary toggle SHALL be off
- **AND** opening extracts in the Queue SHALL NOT trigger AI summarization

#### Scenario: Enabling permits summarization

- **WHEN** the user enables the extract progressive-summary toggle
- **AND** opens an extract whose maximum disclosure level is greater than zero
- **THEN** AI progressive summaries MAY be generated for that extract

#### Scenario: Disabling stops summarization

- **WHEN** the user disables the toggle
- **THEN** subsequently opened extracts SHALL NOT trigger AI summarization
- **AND** no AI provider request SHALL be made by the extract review surface

#### Scenario: Enabling does not backfill

- **WHEN** the user enables the toggle
- **THEN** no summaries SHALL be generated until an eligible extract is next opened

## MODIFIED Requirements

### Requirement: Summarization settings UI

The settings page SHALL include a "Summarization" sub-section with: an auto-summarize
toggle (on/off), a summary length dropdown (short/medium/long), an
include-in-card-content toggle, and an extract progressive-summary toggle.
The summary length dropdown and the include toggle SHALL be disabled when auto-summarize
is off. The extract progressive-summary toggle SHALL remain operable independently of
the auto-summarize toggle.

#### Scenario: Summarization section renders

- **WHEN** user navigates to AI Settings
- **THEN** SHALL see a "Summarization" sub-section with all four controls

#### Scenario: Extract summary toggle is independent

- **WHEN** auto-summarize is off
- **THEN** the summary length dropdown and include toggle SHALL be disabled
- **AND** the extract progressive-summary toggle SHALL still be operable
