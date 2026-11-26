# Proposal: Extend Study Mode with Active Learning

## Problem Statement

1. `FormativeCheckDrawer` and `submit_formative_check` currently trust client-computed `is_correct_choice` for multiple-choice questions and use a naive 8-word + 1-keyword substring heuristic for written responses, with no persisted question definitions, no idempotency, and generic feedback.
2. Study Mode needs source-linked active-learning supplements (personalized explanations, worked examples, misconceptions, memory aids, section summaries) and authoritative embedded/section-level formative practice that records validated `learning_evidence` without corrupting formal exams or FSRS.

## Goals

1. **Authoritative Formative Question Persistence & Grading (Migration 164)**: Persist versioned formative question definitions (`study_formative_questions`) on the backend, strip answer keys before sending questions to the client, grade objective responses in Rust, grade subjective responses via rubric-aligned evaluation, and enforce idempotent submissions (`submission_key`).
2. **Active Learning Supplements**: Add AI tasks (`study-mode-plan-augmentations`, `study-mode-generate-component`, `study-mode-generate-formative-questions`, `study-mode-grade-formative`) using `runTask` + `pedagogicalVerifier`, rendering collapsible, dismissible, source-linked supplements in the Learn view without altering original documents.
3. **Validated Learning Evidence Integration**: Record finalized formative practice outcomes into `learning_evidence` using distinct `source_kind = 'formative-practice'` and `evidence_group_id` so `evidence-v1` mastery updates while formal `exam_attempts` and FSRS remain isolated.

## Dependencies

- `consolidate-study-mode-learning-foundation`, `implement-pedagogical-content-verification`, `add-optional-study-mode-and-learner-preferences`.

## Non-Goals / Out of Scope

- Mutating FSRS card intervals on formative checks.
- Rewriting original document text or user-authored annotations.
