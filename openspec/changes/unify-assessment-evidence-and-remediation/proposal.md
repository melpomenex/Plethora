# Proposal: Unify Assessment Evidence and Remediation

## Why

Plethora already has a robust examination and grading pipeline (`assessment_blueprint_repository.rs`, `exam_session_repository.rs`, `exam_grading_repository.rs`, `learning_evidence_repository.rs`, and `src/lib/study-plans/{assessments,attempts,grading,evidence,remediation}/*`), including answer-key stripping, resumable attempts, immutable response submissions, rubric grading, and transactional `record_evidence_for_grade_tx`. However, four critical gaps prevent assessments and remediation from operating cohesively across the Unified Personal Learning Operating System:

1. **No canonical assessment purpose taxonomy:** Blueprints and attempts do not distinguish among distinct pedagogical purposes (`diagnostic`, `formative`, `retrieval_practice`, `mastery`, `mock_exam`, `summative_exam`, `practical_skill`, `self_assessment`), making it impossible to apply principled evidence weights, exam isolation rules, or hint/reveal policies consistently.
2. **No evidence invalidation on regrade or correction:** When an exam grade is challenged, manually overridden, or regraded—or when a faulty question revision is invalidated—existing `learning_evidence` rows are not transactionally superseded and downstream 5-dimension competency projections and knowledge gaps are not automatically recomputed.
3. **One-size-fits-all remediation:** Current remediation (`remediationPlanner.ts`, `remediationService.ts`) treats all concept gaps similarly rather than routing remediation by failing competency dimension (e.g., `retention`/recall failure vs `comprehension` failure vs `application` failure).
4. **No anti-loop safeguards:** If a learner repeatedly struggles on the same concept, remediation can loop endlessly with the same card or question style instead of escalating modalities, offering an alternative explanation, checking prerequisites, or letting the learner pause/dismiss cleanly.

## What Changes

- **8-purpose Assessment Taxonomy:** Add an explicit `assessment_purpose` enum (`diagnostic`, `formative`, `retrieval_practice`, `mastery`, `mock_exam`, `summative_exam`, `practical_skill`, `self_assessment`) to assessment blueprints, attempts, and evidence ingestion with deterministic per-purpose policies for 5D competency dimension weights, hint/reveal rules, exam isolation, and `model-only` exclusion.
- **Transactional evidence invalidation & recomputation:** When a grade is challenged, overridden, regraded, or a question revision is invalidated, transactionally mark prior `learning_evidence` / `competency_evidence` rows as superseded (`invalidated_at`, `invalidation_reason`, `superseded_by_grade_id`), recompute affected concept summaries and 5D competency projections deterministically, and emit canonical invalidation events—while keeping historical `exam_response_submissions` immutable.
- **Dimension-targeted remediation routing:** Extend `remediationPlanner.ts`, `remediationService.ts`, and `learning_evidence_repository.rs` to route each gap to the appropriate activity modality based on the failing competency dimension (`retention`/recall → spaced retrieval practice; `comprehension` → guided reading re-anchor, Socratic tutor, or `alternative_explanation_of` source; `application` / `transfer` → worked example, practical skill prompt, or rubric-backed problem).
- **Anti-loop safeguards & learner agency:** Enforce per-concept remediation attempt caps, cooldown windows, and a deterministic escalation ladder (switch modality → offer `alternative_explanation_of` → inspect `requires` prerequisite readiness → offer pause/manual dismiss) so learners are never trapped in an infinite remediation loop.
- **SQLite migration `172_adaptive_curricula_and_remediation`:** Add additive schema columns and tables for assessment purpose metadata, evidence invalidation provenance, dimension-targeted remediation plans, and anti-loop attempt tracking (coordinated with `implement-competency-based-adaptive-curricula`).

## Capabilities

### New Capabilities

- `assessment-evidence-remediation`: 8-purpose assessment taxonomy, transactional evidence invalidation and competency recomputation on grade/question corrections, dimension-targeted remediation routing, and anti-loop safeguards integrated with the persistent 5D learner model and unified activity runtime.

### Modified Capabilities

- None (extends `assessment_blueprint_repository.rs`, `exam_session_repository.rs`, `exam_grading_repository.rs`, `learning_evidence_repository.rs`, and `src/lib/study-plans/{assessments,attempts,grading,evidence,remediation}/*` additively).

## Dependencies

- `establish-persistent-learner-model` (Phase 1): Provides the 5-dimension competency model (`exposure`, `comprehension`, `retention`, `application`, `transfer`), correlated-card damping, and provenance-backed `competency_evidence` / `competency_projections`.
- `unify-learning-activity-runtime` (Phase 2): Provides unified `LearningActivity` adapters and exam-isolation lifecycle hooks so assessments and remediations launch seamlessly inside `LearningSession`.
- Coordinates SQLite migration `172_adaptive_curricula_and_remediation` and `alternative_explanation_of` / `requires` lookup with `implement-competency-based-adaptive-curricula` (Phase 3).

## Non-Goals

- Modifying or mutating immutable `exam_response_submissions` records during regrade or invalidation.
- Allowing unverified `model-only` self-checks or casual AI chat turns to bypass `knowledgePolicy` guards and inflate demonstrated mastery.
- Replacing FSRS-7 (`src-tauri/src/algorithms/fsrs7/`) as the sole authority for flashcard/extract review intervals.
- Forcing learners to complete remediation before returning to reading, review, or other goals.

## Privacy & Security

- All source-grounded assessment generation, rubric grading, and remediation passage selection MUST enforce `src-tauri/src/database/document_privacy.rs` and `src/lib/ai/assistant/privacyGate.ts`.
- Documents marked `is_local_only` or `is_ai_excluded` MUST never be sent to cloud AI models for question generation, rubric grading, or Socratic remediation; deterministic objective grading (`objectiveGrading.ts`) and local/manual grading (`manualGrading.ts`) remain fully available offline.
- Answer keys remain stripped from public attempt payloads (`publicQuestion.ts`) during `mock_exam`, `summative_exam`, and `mastery` sessions.
- Health Vault (`health/health.db`) data is strictly isolated and never referenced in assessment prompts, grading rubrics, or remediation plans.

## Migration & Backward Compatibility

- Migration `172_adaptive_curricula_and_remediation` is additive, transactional, and idempotent.
- Existing `assessment_blueprints` and `exam_attempts` without an explicit `assessment_purpose` default cleanly based on their legacy `mode` (e.g., `timed_exam` → `summative_exam`, `practice` → `formative`, `self_check` → `self_assessment`) with zero data loss.
- Existing `learning_evidence` rows remain valid (`invalidated_at IS NULL`) and existing `learning_gaps` / `learning_remediations` continue to render seamlessly.

## Performance

- Evidence invalidation and recomputation execute inside a single SQLite transaction scoped strictly to the affected `concept_id` set (typically 1–10 concepts per question/grade), completing in `< 15ms` for typical exam regrades.
- Remediation planning and anti-loop evaluation remain pure deterministic operations (`O(G)` over active gaps), validated against `src/lib/study-plans/evidence/evidenceAggregation.bench.ts` and `npm run bench:check`.

## Rollback / Recovery

- Because historical `exam_response_submissions` and superseded `learning_evidence` rows are preserved (marked via `invalidated_at` rather than hard-deleted), any erroneous regrade or invalidation can be audited and reversed by issuing a corrective grade and re-running deterministic recomputation.
- All schema changes are additive; disabling dimension-targeted remediation falls back cleanly to standard gap display without losing assessment or evidence records.

## Impact

- **Backend (Rust/SQLite):** `src-tauri/src/database/migrations.rs` (`172_adaptive_curricula_and_remediation`), `src-tauri/src/database/{assessment_blueprint,exam_session,exam_grading,learning_evidence}_repository.rs`, `src-tauri/src/commands/{study_exams,study_evidence}.rs`.
- **Frontend Domain:** `src/lib/study-plans/assessments/{blueprintService,questionValidation,publicQuestion}.ts`, `src/lib/study-plans/attempts/{attemptPolicy,attemptController}.ts`, `src/lib/study-plans/grading/{gradingCoordinator,manualGrading}.ts`, `src/lib/study-plans/evidence/{evidenceAggregation,gapRules,remediationPlanner}.ts`, `src/lib/study-plans/remediation/remediationService.ts`.
- **UI:** Assessment purpose selector & policy badges, grade challenge/override & evidence recomputation audit trail, dimension-targeted remediation cards, and anti-loop escalation/dismissal controls.
