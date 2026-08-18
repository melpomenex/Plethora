## ADDED Requirements

### Requirement: Section mention chips keep a stable identity while composing

A `#` section mention selected from the popup SHALL remain selected while the user continues typing, while the input is formatted for display, and when history navigation restores a previous prompt. Token insertion and chip filtering SHALL use one consistent identity (id or title) so a picked section is never discarded by the next keystroke.

#### Scenario: A picked chip survives the next keystroke

- **WHEN** the user picks a section from the `#` popup in Document Q&A and then types any character
- **THEN** the selected-section chip remains present and attached to the prompt
- **AND** sending resolves the same section

#### Scenario: History restore recovers chips

- **WHEN** the user navigates to a previous prompt that contained section mentions
- **THEN** the chips are restored with their sections selected

### Requirement: Section mention availability is communicated honestly

Surfaces offering the `#` trigger SHALL indicate when sections are still loading, and SHALL explain — rather than silently doing nothing or showing a bare "No sections available" — when `#` cannot list sections because no document is targeted (Whole-Library mode or a non-document assistant context).

#### Scenario: Loading state instead of a false empty

- **WHEN** the user opens the `#` popup while the document's sections are still being fetched
- **THEN** the popup shows a loading state rather than "No sections available"

#### Scenario: No document targeted explains the limitation

- **WHEN** the user types `#` in a context with no targeted document (Whole-Library Q&A or a non-document assistant)
- **THEN** the surface explains that `#` references sections of an open document and how to target one (e.g. `@`-mention)
- **AND** does not present an unconditional "No sections available" dead end

### Requirement: Send-time section resolution tolerates cosmetic drift

Resolving a mention token against the current section catalog SHALL normalize case, whitespace, and punctuation before declaring the token unresolved. A token whose normalized title matches exactly one section SHALL resolve; ambiguous matches SHALL fail with an error naming the duplicates.

#### Scenario: Case and punctuation drift still resolves

- **WHEN** a stored chip's title differs from the freshly extracted heading only in casing, whitespace, or punctuation
- **THEN** the mention resolves to that section

### Requirement: Pseudo-document assistant contexts resolve or explain

Assistant contexts backed by attached content rather than a real document (podcast transcripts; `extract:` pseudo-ids) SHALL resolve `#` mentions against that attached content, or SHALL fail with a message explaining what cannot be focused — never the generic "Could not focus the selected section … no request was made" for a context that can never resolve structurally.

#### Scenario: Podcast chapter mention resolves from the transcript

- **WHEN** the user mentions a transcript-derived chapter in a podcast assistant context and sends
- **THEN** the request is made with that chapter's transcript range as focused context

#### Scenario: Unresolvable pseudo-document explains itself

- **WHEN** a `#` mention cannot be resolved in a pseudo-document context
- **THEN** the surfaced error identifies the context type and why focus is unavailable
