# Study Mode Adaptive Practice Specification

## ADDED Requirements

### Requirement: Typed, Extensible Multi-Format Practice Question Engine
Study Mode Practice SHALL support typed interactive question rendering and deterministic/rubric grading for `multiple_choice`, `free_recall`, `fill_blank`, `ordering`, and `scenario_error` question formats, using an extensible registry that accommodates additional formats (`compare_contrast`, `problem_solving`, `teach_back`) without rewriting the session runner.

#### Scenario: Learner completes ordering and fill-in-the-blank questions
- **GIVEN** a continuous practice session is active
- **WHEN** the engine presents a `fill_blank` or `ordering` question and the learner submits an answer
- **THEN** the engine evaluates the response, displays whether it is understood, partial, or needs review, and explains why any incorrect answer was wrong.

### Requirement: Semantic Question Deduplication
Study Mode Practice SHALL compute deterministic content-and-concept-based semantic fingerprints (replacing timestamp `Date.now()` fingerprints) and detect high-overlap candidate prompts so consecutive questions in a session do not repeat the same question.

#### Scenario: Timestamp differences do not bypass deduplication
- **GIVEN** two candidate questions with the same concept and normalized prompt wording generated at different timestamps
- **WHEN** `computeSemanticQuestionFingerprint` and `isSemanticallyDuplicateQuestion` evaluate them
- **THEN** they produce identical semantic fingerprints and the second question is flagged as a duplicate.

### Requirement: Evidence-Driven Dynamic Difficulty Selection
Study Mode Practice SHALL select target question difficulty (`1` to `5`) dynamically from observed `ConceptMasterySummary` / FSRS evidence and recent session performance rather than hardcoding difficulty `2`.

#### Scenario: Difficulty adapts upward on mastery and downward on misconceptions
- **GIVEN** a learner has `"needs-attention"` evidence or just missed a question with a misconception
- **WHEN** the next practice question difficulty is computed
- **THEN** difficulty steps down toward foundational (`1`–`2`)
- **AND** when a learner demonstrates consecutive correct recalls with strong evidence, difficulty steps up (`3`–`5`).

### Requirement: Hints, Actionable Misconception Feedback, and Optional Inline Checks
Practice sessions SHALL offer progressive hints without revealing the answer prematurely, explain *why* an incorrect response reflects a misconception, and allow learners to toggle non-intrusive inline knowledge checks in the Original Source pane.

#### Scenario: Offline practice gracefully reports unavailable generation while preserving active question review
- **GIVEN** the learner is offline during a practice session
- **WHEN** generating a new AI question fails
- **THEN** a contextual error with Retry is shown while already-loaded questions and prior feedback remain inspectable.
