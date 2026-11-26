# Proposal: Integrate Study Mode Adaptive Remediation

## Problem Statement

Mastery summaries, knowledge gap detection, Socratic tutoring, Study Plan remediation, and flashcard promotion are currently disconnected: Rust `recompute_concepts_tx` only runs 1 of 7 gap rules, `GuidedReadingPanel` lacks `onOpenTutor`, `WeakTopicWorkspace` is not wired to `getRemediationTrailItems`, and learners have no unified remediation loop from misconception -> targeted intervention -> distinct re-assessment -> explicit flashcard promotion.

## Goals

1. **Unify `evidence-v1` Mastery & Gap Detection**: Align Rust misconception resolution with TS (`evidenceAggregation.ts`: require score >= 0.8 without misconception to clear) and surface multi-signal knowledge gaps in Study Mode and `WeakTopicWorkspace`.
2. **Closed-Loop Adaptive Remediation**: Based on recorded misconceptions/gaps, offer user-controlled remediation actions (reopen exact source passage, alternate explanation, worked example, contrasting example, prerequisite review, Socratic tutor via `TutorSheet`, distinct-question re-practice, explicit flashcard promotion).
3. **Preserve Distinctions & FSRS Integrity**: Never equate reading/audio/tutor completion with mastery; never auto-grade or auto-create FSRS cards without explicit user approval.

## Dependencies

- `extend-study-mode-with-active-learning`, `knowledge-gap-detection`, `ai-socratic-tutoring`.

## Non-Goals / Out of Scope

- Automatically modifying published Study Plan curricula without user consent.
