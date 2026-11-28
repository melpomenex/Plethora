# Tasks: Unify Assessment Evidence and Remediation

## 1. Database Schema & Rust Repositories
- [ ] Extend migration `172_adaptive_curricula_and_remediation` in `src-tauri/src/database/migrations.rs` (coordinated with `implement-competency-based-adaptive-curricula`) to add `assessment_purpose` on blueprints/attempts/evidence, invalidation provenance columns (`invalidated_at`, `invalidation_reason`, `superseded_by_grade_id`, `target_dimension`) on `learning_evidence`, and dimension/anti-loop columns (`target_dimension`, `modality`, `attempt_count`, `escalation_stage`, `cooldown_until`, `dismissed_at`, `dismiss_reason`, `rationale_deterministic`) on `learning_remediations`.
- [ ] Update `src-tauri/src/database/assessment_blueprint_repository.rs` and `exam_session_repository.rs` to persist and validate the 8-purpose `assessment_purpose` taxonomy with safe migration defaults from legacy `mode` values.
- [ ] Implement `invalidate_and_recompute_evidence_tx` in `src-tauri/src/database/learning_evidence_repository.rs` to transactionally supersede stale evidence on grade override, regrade, or question invalidation, recompute affected concept summaries/5D projections/gaps from active evidence only, and emit canonical `learning_events`.
- [ ] Update `src-tauri/src/database/exam_grading_repository.rs` to invoke `invalidate_and_recompute_evidence_tx` whenever a grade supersedes a prior `is_current = 1` grade or a manual override is finalized, preserving immutable `exam_response_submissions`.
- [ ] Expose Tauri commands for purpose-typed blueprint creation, grade challenge/override/regrade with evidence recomputation, and remediation escalation/cooldown/dismissal actions.

## 2. TypeScript Domain Engine (Taxonomy, Evidence & Remediation)
- [ ] Define the 8-purpose `AssessmentPurpose` policy table (dimension weights, strict isolation flag, hint rules, mastery eligibility) in `src/lib/study-plans/assessments/blueprintService.ts` and `src/lib/study-plans/attempts/attemptPolicy.ts`.
- [ ] Verify `src/lib/study-plans/assessments/publicQuestion.ts` enforces answer-key stripping and spoiler suppression for `mock_exam`, `summative_exam`, and `mastery` purposes, and `self_assessment` / `model-only` exclusion from mastery evidence.
- [ ] Update `src/lib/study-plans/evidence/{evidenceAggregation,gapRules}.ts` to ignore invalidated evidence (`invalidated_at != null`) and map each active gap to its failing competency dimension(s).
- [ ] Upgrade `src/lib/study-plans/evidence/remediationPlanner.ts` and `src/lib/study-plans/remediation/remediationService.ts` with dimension-targeted routing (`retention` vs `comprehension` vs `application` vs `transfer` vs `exposure`), deterministic rationale generation, and the 4-stage anti-loop escalation ladder (`0..=3`) with attempt caps and cooldowns.
- [ ] Enforce `privacyGate.ts` / `is_local_only` / `is_ai_excluded` checks across assessment generation, grading, and remediation routing.

## 3. UI Surfaces & Learner Controls
- [ ] Add `assessment_purpose` selector and clear policy badges (isolation, hints, mastery impact) to assessment creation and attempt launch screens.
- [ ] Add grade override/regrade confirmation and evidence-recomputation audit banner in exam review UI showing superseded vs active evidence.
- [ ] Render dimension-targeted remediation cards with deterministic rationale, one-click launch into the matching activity modality, and Skip / Postpone / Dismiss controls at every stage.
- [ ] Render anti-loop escalation notices (modality switch, `alternative_explanation_of` suggestion, upstream `requires` prerequisite alert, and cooldown pause/exit options).

## 4. Verification, Benchmarks & Privacy Audits
- [ ] Add Rust unit/integration tests for 8-purpose taxonomy persistence, `self_assessment` and `model-only` mastery exclusion, transactional `invalidate_and_recompute_evidence_tx` on regrade/override/question invalidation, and `exam_response_submissions` immutability.
- [ ] Add Vitest unit tests covering dimension-targeted remediation routing (recall vs comprehension vs application vs transfer vs exposure), deterministic rationales, anti-loop escalation stages `0..=3`, cooldown enforcement, and learner dismissal.
- [ ] Add automated privacy tests asserting `is_local_only` and `is_ai_excluded` documents never transmit content to cloud AI during assessment grading or remediation planning.
- [ ] Run `src/lib/study-plans/evidence/evidenceAggregation.bench.ts` and `npm run bench:check` to verify recomputation and aggregation performance budgets.
