## MODIFIED Requirements

### Requirement: Cloze prompts hide deleted text until reveal
When a cloze flashcard is shown in Review, Queue Scroll Mode, or Optimal Sessions, the prompt SHALL render supported cloze markers as hidden answers and SHALL NOT expose marker syntax or deleted text before reveal. This SHALL work when ranges are missing, empty, malformed, or stale and when the source exists only in the question. Valid markers SHALL take precedence over cached ranges. Revealing SHALL show the answers in context with formatting preserved. Supported syntax SHALL include simplified `{{answer}}` and `{{::answer}}`, numbered `{{cN::answer}}`, hints `{{cN::answer::hint}}`, and recognized legacy `[[cN::answer]]`, including multiline content. All deletions on a persisted card SHALL be hidden/revealed together; indexes SHALL NOT implicitly create separately scheduled siblings.

#### Scenario: Simplified cloze marker with empty ranges
- **WHEN** the user reviews `Larger groups had {{military and economic advantages}}.` with empty stored ranges
- **THEN** the prompt displays `Larger groups had [...].` with braces and answer hidden in every mode

#### Scenario: Reveal a simplified cloze marker
- **WHEN** the user reveals that simplified cloze
- **THEN** `military and economic advantages` appears in its original context

#### Scenario: Numbered cloze marker with a hint
- **WHEN** the unrevealed source contains `{{c1::mitochondria::cell organelle}}`
- **THEN** only the hint replaces the answer in the review prompt

#### Scenario: Reveal a numbered cloze marker
- **WHEN** the user reveals that numbered cloze
- **THEN** `mitochondria` appears without marker syntax

#### Scenario: Cloze ranges are unavailable
- **WHEN** valid marker syntax has missing, empty, out-of-bounds, overlapping, or outdated stored ranges
- **THEN** all modes use marker semantics with equivalent hidden/revealed results

#### Scenario: Question-only and multiple-index cloze
- **WHEN** the source question alone contains repeated c1, c2, simplified, or legacy markers
- **THEN** each supported deletion is hidden until reveal and indexes/content survive without creating additional reviews

#### Scenario: Marker-free legacy ranges
- **WHEN** a legacy cloze has valid ranges against its marker-free source, including non-ASCII text
- **THEN** the intended text is hidden and revealed identically in every mode without splitting formatted markup incorrectly

### Requirement: Queue review cards provide top-right edit and delete actions
Each flashcard in Queue Scroll Mode and Optimal Sessions SHALL provide accessible pencil/edit and trash/delete controls at the top right without obscuring prompts or grading. Both SHALL target the stable persisted learning-item identity, respect pending mutations, and use the same persistence/session contracts as Review and document-linked card views.

#### Scenario: Edit a card in place
- **WHEN** the user selects the pencil control
- **THEN** the canonical card editor opens for that card and a successful save updates it without resetting the session's place

#### Scenario: Delete the current card
- **WHEN** the user selects the trash control and undoable deletion succeeds
- **THEN** the card is removed and the next available item is presented without requiring a rating or skipping its successor

## ADDED Requirements

### Requirement: Review previews and auxiliary content do not disclose hidden answers
Unrevealed cloze review titles, queue listings, accessible labels, automatic speech, and auxiliary explanations SHALL use safe prompt content rather than raw answer-bearing source or card-type labels. Unusable clozes SHALL expose repair/edit/skip state instead of silently showing answers as basic text; grading SHALL be unavailable until the card is valid. Intentional source navigation and labeled authoring fields SHALL retain access to source content.

#### Scenario: Title and explanation parity
- **WHEN** an unrevealed cloze appears in the queue header and an explanation is prepared
- **THEN** the header contains no raw markers/hidden answer and the explanation is grounded in the actual card content rather than the phrase Cloze Deletion
- **AND** answer-bearing explanation content is withheld onscreen until reveal

#### Scenario: Invalid cloze cannot be safely hidden
- **WHEN** malformed source/ranges leave no valid deletion
- **THEN** review presents repair guidance, edit and skip rather than exposing plaintext as a gradeable prompt
