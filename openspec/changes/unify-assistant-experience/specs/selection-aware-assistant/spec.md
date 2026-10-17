## MODIFIED Requirements

### Requirement: Select-to-Ask hands off into the Assistant window thread

Invoking Ask from a reader selection SHALL open the appropriate canonical Assistant presentation with the selected passage and source reference captured before the transient selection disappears. Entering a question SHALL submit it into that thread and leave follow-up input available; opening/preparing alone SHALL not submit. The selection, original source identity/version and captured locator SHALL persist with the conversation and its turns. The thread SHALL be reopenable from history on supported presentations. A different selection SHALL prepare a separate thread or an explicitly accepted context reseed, preserving the previous conversation and draft.

#### Scenario: Right-click Ask opens Assistant thread
- **GIVEN** the user has selected text in a supported reader
- **WHEN** they choose Ask a question, type Why does this matter and submit
- **THEN** the appropriate Assistant presentation shows the quoted selection, document reference and submitted question with a reply in progress
- **AND** follow-up input remains available in that canonical conversation

#### Scenario: Follow-up retains selection without re-selecting
- **GIVEN** a selection-seeded conversation has answered one question
- **WHEN** the highlight disappears and the user asks Give me an example
- **THEN** the captured selection and authorized prior context remain available for that thread

#### Scenario: New selection starts new context
- **GIVEN** a prior selection conversation contains answers and an unsent draft
- **WHEN** the user makes a different selection and invokes Ask
- **THEN** a new selection thread is prepared or reseeding requires an explicit action
- **AND** the prior thread and draft remain recoverable without mixed source attribution

#### Scenario: Reopen a selection conversation
- **GIVEN** a selection conversation was durably saved
- **WHEN** the user dismisses it, reloads and resumes it from History
- **THEN** the same conversation, captured selection/source, citations and draft restore without re-selection or tool replay

## ADDED Requirements

### Requirement: Edited selection text retains honest provenance

Editing an attached passage SHALL preserve the original captured text and source reference separately from the edited prompt text. The UI SHALL identify edited text as edited. An edited quote SHALL not become a verified source quotation unless matched to the authorized original material. Clearing it SHALL affect future primary context without changing historical answers or silently restoring removed text.

#### Scenario: User edits the excerpt
- **GIVEN** a captured source quote is attached
- **WHEN** the user edits its wording and asks a question
- **THEN** the edited context is visible as such and the original remains recoverable
- **AND** generated quotations are validated against actual source content rather than the user's rewritten wording
