## Context

`StudyPlanProgress`, C5 evidence projections, C7 remediation and Learn This card acceptance already cover parts of this journey. The knowledge-policy and lesson-session changes supply versioned authority and a stable lesson destination.

## Goals / Non-Goals

**Goals:** Compose existing read models into a useful recommendation and preserve context across study, reassessment and review.

**Non-Goals:** A second mastery authority or scheduler, automatic prerequisite edits, and calendar/achievement state.

## Decisions

1. **Use a deterministic recommendation projection.** Prefer an eligible resumable lesson; otherwise consider evidence-backed remediation and then available topics in prerequisite order with a stable tie-breaker. Explain the selected reason (including an unmet prerequisite when relevant), offer browsing and override, and expose blocked or completed states. Advisory sequencing never hides topics. Read assessment evidence from the existing final-grade projector and actual due counts from Review, using accepted plan/card links and deduplication.
2. **Make route context a value.** Carry plan/version/node/objective and optional result/gap IDs into lesson, practice and reassessment, with a recoverable return destination. Freeze resolved membership for collection/tag entry; keep reader document, range or extract preselection editable. A changed head or invalid source produces an explicit recovery choice, never a global fallback.
3. **Vary practice between committed revisions.** Reuse blueprint quotas and checked attempts. The next set can change difficulty, cue distance and application/transfer emphasis, excluding prior fingerprints for a fresh measurement. Retake Same Paper remains distinct from a new assessment. Store hint use, repeats, grader status and provenance with results. Exam/diagnostic never reveal practice hints or mutate active papers.
4. **Treat review as a proposal.** Reuse Learn This acceptance with source/plan/objective linkage and stable acceptance IDs. Offer editable candidates where permitted; unverified model cards are visibly unverified and require user review before ordinary card creation. A proposal, dismissal, or acceptance does not submit a review, rewrite existing schedules/priority or mutate Queue ordering. A review lapse may suggest a lesson without producing a failed exam result.

## Risks / Trade-offs

- [Confusing signals] → Show coverage, activity and demonstrated performance separately, including recency and assessment limitations. Weak signals explain a suggestion, not a mastery percentage.
- [Stale route or due data] → Refresh projections on return and report unavailable counts rather than zero. Preserve real attempt history even if a node is excluded.
- [Performance] → Use bounded plan-level projections and batch due counts; protect existing Queue and bundle budgets.

## Migration Plan

Introduce Plan Home over existing plans and retain the editor and historical deep links. Add optional card links without guessing attribution for existing cards. Revert navigation separately from assessment and review data.
