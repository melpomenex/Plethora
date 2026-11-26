# Study Mode Active Learning Specification

## ADDED Requirements

### Requirement: Authoritative Persisted Formative Questions and Idempotent Grading
Formative questions SHALL be persisted with versioned answer keys and rubrics on the backend prior to submission, answer keys SHALL NOT be exposed to the client before grading, and submissions SHALL be graded authoritatively and idempotently.

#### Scenario: Tampered client correctness flag ignored
- **WHEN** a client submits a formative multiple-choice answer with a conflicting `is_correct_choice` flag
- **THEN** the backend derives correctness exclusively from the persisted `study_formative_questions.answer_key_json` and submitted `selected_index`.

#### Scenario: Duplicate submission idempotency
- **WHEN** the same `submission_key` is submitted twice due to retry or double-click
- **THEN** only one submission and one `learning_evidence` record are persisted.

### Requirement: Source-Linked Active Learning Supplements
The Study Mode Learn view SHALL present collapsible, individually dismissible, source-linked supplements (explanations, worked examples, misconceptions, memory aids, section summaries) without modifying original document text.

#### Scenario: Dismissing a supplement preserves original document
- **WHEN** a learner dismisses a generated worked example in Study Mode
- **THEN** the supplement is hidden and original document content and annotations remain untouched.
