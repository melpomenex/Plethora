## ADDED Requirements

### Requirement: Structured free-response assessment

During active recall and (optionally) flashcard review, the system SHALL accept a natural
language answer and derive a structured assessment: correctness classification
(correct/partial/incorrect/misconception), completeness, confidence, omitted key points,
misconception description, and suggested correction — validated before use.

#### Scenario: Misconception detection
- **WHEN** a user answers "because it compresses memory" to a question about why virtual
  memory can exceed physical RAM
- **THEN** the assessment classifies the answer as a misconception with a description and
  suggested correction including the missing concepts (e.g. virtual address space, disk-backed
  paging)

#### Scenario: Paraphrased correct answer
- **WHEN** the user's answer is semantically correct but worded differently from the card
  answer
- **THEN** the assessment classifies it as correct rather than string-mismatched

### Requirement: Scheduler authority is preserved

The existing scheduling algorithm SHALL remain the sole scheduler. AI assessment SHALL be
recorded as additional signal and UI feedback only; the user-selected grade SHALL remain the
scheduling input. Any automatic-grade mode SHALL be experimental, off by default, and SHALL
NOT silently change review semantics.

#### Scenario: Assessment does not alter scheduling
- **WHEN** an assessment scores an answer as incorrect but the user selects "Good"
- **THEN** scheduling proceeds exactly as it would have without the assessment

#### Scenario: Auto-grade suggestion is advisory
- **WHEN** the experimental auto-grade flag is enabled
- **THEN** the system at most highlights a suggested grade button and never submits a grade on
  the user's behalf

### Requirement: Assessment persistence and provenance

Each assessment SHALL be persisted linked to its review/answer context with provider, model,
and timestamp, separated from the review result's scheduling columns, and SHALL be available
for calibration analysis.

#### Scenario: Assessment retrievable for calibration
- **WHEN** a developer or evaluation run queries assessments for a labeled fixture set
- **THEN** stored assessments include classification, scores, missing concepts, and provenance
  sufficient to compute agreement metrics

### Requirement: Graceful unavailability

When no assessment-capable provider is available, the review flow SHALL behave exactly as
today (show answer, grade buttons) with no errors surfaced.

#### Scenario: No AI during review
- **WHEN** AI is unavailable or disabled during a review session
- **THEN** review proceeds identically to the pre-feature experience

### Requirement: Calibration evaluation

The repository SHALL include labeled evaluation fixtures covering correct, partially correct,
wrong, misconception-bearing, verbose-but-wrong, paraphrased-correct, and adversarial answers,
asserted structurally in tests with a deterministic fake provider.

#### Scenario: Calibration suite runs in CI
- **WHEN** CI runs the test suite
- **THEN** assessment-pipeline tests validate the full structured output path without any
  model hardware
