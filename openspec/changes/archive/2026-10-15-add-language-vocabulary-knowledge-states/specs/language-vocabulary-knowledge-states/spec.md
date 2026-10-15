# Spec: language-vocabulary-knowledge-states

## ADDED Requirements

### Requirement: Distinct knowledge lifecycle

Each profile-scoped lexical or phrase object SHALL support distinct semantic states equivalent to New, Encountered, Learning, Familiar, Known, and Ignored. The implementation MAY name them differently only if the meanings remain distinguishable and queryable.

#### Scenario: First exposure
- **WHEN** a new lemma appears in a studied sentence
- **THEN** safe encounter bookkeeping may move it from New to Encountered, without creating an SRS item

### Requirement: Deliberate memorization is separate

The system SHALL represent deliberate Memorize/SRS association independently from knowledge state. Encountering, looking up, highlighting, or marking Familiar/Known MUST NOT create a learning item unless the user explicitly requests memorization or accepts a suggestion.

#### Scenario: Lookup does not flood reviews
- **WHEN** a user looks up 100 new words while reading
- **THEN** the words gain lookup/encounter evidence only and the review queue contains no newly created cards from those lookups

### Requirement: Manual state controls

Users SHALL be able to set and clear language state for a word or phrase from Dictionary Peek/reader surfaces, with accessible controls on desktop, keyboard, touch, mobile, and e-ink. Manual overrides SHALL be profile-scoped.

#### Scenario: Mark lemma Known
- **WHEN** a user marks `hablar` Known after viewing `hablando`
- **THEN** subsequent high-confidence forms resolve to the Known state while the original `hablando` occurrence remains recoverable

### Requirement: Safe automatic transitions

Automatic transitions SHALL be conservative, documented, and limited to exposure/evidence updates unless the user has enabled a profile policy. A lookup or single encounter MUST NOT imply durable Known state.

#### Scenario: Repeated exposure
- **WHEN** a learner sees a word in five different sentences
- **THEN** encounter/document counts increase and the system may suggest a state change, but it does not silently mark the word Known or create an SRS item

### Requirement: Undo and history

Manual and batch state changes SHALL support undo within the existing undo affordance where available; state history SHOULD retain actor, time, previous/new state, and source for audit/analytics.

#### Scenario: Undo batch operation
- **WHEN** a user marks a selected set of 20 words Known and presses Undo
- **THEN** all 20 state changes revert as one operation without reverting unrelated reader or Queue state

### Requirement: Profile isolation and exact-form precedence

State SHALL be isolated by profile. When lemma resolution is missing or low-confidence, exact-form state remains valid; exact-form manual override takes precedence over inherited lemma state.

#### Scenario: Unsupported morphology
- **WHEN** a processor cannot link `hablando` to `hablar`
- **THEN** the user can manage `hablando` independently and the UI does not claim that `hablar` is Known

### Requirement: Evidence for passive and active knowledge

The model SHALL support separate evidence dimensions for passive recognition and active production, including reading, cloze, writing, dictation, and speaking when those features exist. Evidence SHALL be additive and confidence-aware, not a replacement for the display state.

#### Scenario: Production evidence
- **WHEN** a learner successfully produces a currently Known-in-reading word in a cloze task
- **THEN** active evidence increases without erasing passive evidence or forcing a new display state

### Requirement: Batch/import/export behavior

Users SHALL be able to batch-manage states and import/export known-word lists with explicit profile selection, duplicate handling, and preview. Import MUST NOT create SRS items unless the user separately requests it.

#### Scenario: Import known words
- **WHEN** a user imports a Spanish known-word list
- **THEN** matching lexical entries receive a marked manual/imported Known override and unmatched exact forms are created without cards

### Requirement: Queue/review invariants

Language state interactions MUST NOT rate, complete, advance, dismiss, postpone, reschedule, or change reading/listening position for Queue/review items.

#### Scenario: State from Queue reader
- **WHEN** a user marks a word Learning inside Queue Scroll Mode
- **THEN** the current Queue item and scheduler state remain unchanged
