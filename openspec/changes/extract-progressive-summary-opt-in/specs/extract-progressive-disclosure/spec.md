## Purpose

Defines how an extract is presented during Queue / Scroll Mode review when progressive
disclosure is involved: whether AI summaries may be generated, what the reviewer sees
when they are not, and how an extract's disclosure level is defaulted, displayed, and
persisted.

## ADDED Requirements

### Requirement: Automatic extract summaries are opt-in

The system SHALL generate AI progressive summaries for an extract only when both
conditions hold: the global setting "Generate AI summaries for extracts during review"
is enabled, and the extract's maximum disclosure level is greater than zero. With the
setting disabled, the extract review surface SHALL NOT make any AI provider call for
summaries, regardless of any extract's stored disclosure configuration.

Generation SHALL happen at most once per extract: if cached summaries already exist
they SHALL be served without a new provider call. A generation failure SHALL surface an
error in the card and SHALL leave the full extract text available for review; it SHALL
NOT block rating or navigation.

#### Scenario: Setting disabled never summarizes

- **WHEN** the global extract-summary setting is disabled
- **AND** the reviewer opens an extract whose maximum disclosure level is greater than zero
- **THEN** no AI summary generation SHALL be requested
- **AND** the card SHALL show the complete extract text

#### Scenario: Setting enabled generates once and caches

- **WHEN** the global extract-summary setting is enabled
- **AND** the reviewer opens an extract with a maximum disclosure level greater than zero and no cached summaries
- **THEN** the system SHALL generate the summaries once
- **AND** SHALL persist them on the extract

#### Scenario: Cached summaries are reused

- **WHEN** an extract already has cached progressive summaries
- **THEN** opening it SHALL display the cached summaries
- **AND** SHALL NOT issue a new AI provider call

#### Scenario: Extract with disclosure disabled is never summarized

- **WHEN** the global setting is enabled
- **AND** the reviewer opens an extract whose maximum disclosure level is zero
- **THEN** no AI summary generation SHALL be requested

#### Scenario: Generation failure falls back to full text

- **WHEN** summary generation fails
- **THEN** an error SHALL be shown in the card
- **AND** the full extract text SHALL remain visible and reviewable

### Requirement: Extracts render in full when disclosure is inactive

When the global extract-summary setting is disabled, or when the extract's maximum
disclosure level is zero, the extract card SHALL render the complete extract text in the
editable content area. In this state the card SHALL NOT show a summary badge and SHALL
NOT show a disclosure-level indicator.

#### Scenario: Setting off shows editable full text

- **WHEN** the global extract-summary setting is disabled
- **THEN** the extract card SHALL render the complete extract text
- **AND** the text SHALL be editable
- **AND** no "AI Summary" badge SHALL be displayed

#### Scenario: Disclosure disabled shows editable full text

- **WHEN** an extract has a maximum disclosure level of zero
- **THEN** the extract card SHALL render the complete extract text
- **AND** no disclosure-level indicator SHALL be displayed

### Requirement: New extracts default to progressive disclosure off

New extracts SHALL be created with a maximum disclosure level of zero unless the user
explicitly selects a level during creation. The level shown as selected in the extract
dialog SHALL equal the level that will be stored.

#### Scenario: Default creation stores zero

- **WHEN** the user creates an extract without changing the progressive disclosure selector
- **THEN** the stored maximum disclosure level SHALL be zero
- **AND** no summaries SHALL be generated for it when it later appears in the Queue

#### Scenario: Explicit level is stored

- **WHEN** the user selects level 3 while creating an extract
- **THEN** the stored maximum disclosure level SHALL be 3

#### Scenario: Dialog reflects stored value

- **WHEN** the user edits an existing extract
- **THEN** the progressive disclosure selector SHALL show that extract's stored maximum disclosure level

### Requirement: Progressive disclosure can be turned off per extract

Selecting level zero in the extract editor SHALL persist zero as the extract's maximum
disclosure level, and subsequent renders SHALL show the full extract text.

#### Scenario: Disabling disclosure on an existing extract

- **WHEN** the user edits an extract whose maximum disclosure level is greater than zero
- **AND** selects level zero
- **THEN** the stored maximum disclosure level SHALL become zero
- **AND** the next render of that extract SHALL show the complete text without summaries

### Requirement: Disclosure level display is internally consistent

When disclosure is active, the header level indicator and the content badge SHALL report
the same stage for the same state, derived from the same current/maximum pair and the
same numbering convention. They SHALL agree on whether the reviewer is looking at a
summary, a partial reveal, or the full extract.

#### Scenario: First summary stage

- **WHEN** an extract is displaying its first AI summary stage
- **THEN** the header indicator and the content badge SHALL state the same stage number

#### Scenario: Final stage is full content

- **WHEN** an extract has advanced to its final disclosure stage
- **THEN** the header indicator and the content badge SHALL both describe the full extract
