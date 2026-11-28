# Tasks: Implement Competency-Based Adaptive Curricula

## 1. Database Schema & Rust Repositories
- [ ] Add migration `172_adaptive_curricula_and_remediation` in `src-tauri/src/database/migrations.rs` (coordinated with `unify-assessment-evidence-and-remediation`) introducing typed conceptual relationship columns (`relationship_type`, `provenance`, `confidence`, `is_uncertain`, `evidence_anchor_json`, `user_override_state`, `bypass_reason`, `updated_at`), `curriculum_node_overrides`, and `curriculum_grounding_checks` with indexes and non-destructive defaults for existing plans.
- [ ] Extend `src-tauri/src/database/study_plan_repository.rs` to persist, query, update, bypass, retype, and undo typed conceptual edges while enforcing strict `requires`-subgraph cycle validation (`CYCLE_DETECTED`).
- [ ] Add Rust repository methods for `curriculum_node_overrides` and `curriculum_grounding_checks`, and wire sync journal emission (`journal_entity`) respecting `document_privacy.rs`.
- [ ] Expose Tauri commands in `src-tauri/src/commands/study_plans.rs` for typed edge CRUD, prerequisite bypass/correction, adaptive progression overlay snapshot, and grounding verification/recovery.

## 2. TypeScript Domain Engine & Graph Projection
- [ ] Update `src/lib/study-plans/topology.ts` to partition edges by `relationship_type`, enforce `O(V + E)` cycle detection strictly on active `requires` edges, use `builds_upon` as a soft tie-breaker, and return exact cycle paths on error.
- [ ] Extend `src/lib/study-plans/graph/{types,projection,layout,traversal}.ts` to represent all 7 relationship kinds, provenance/confidence/uncertainty metadata, and filterable associative edge layers.
- [ ] Implement deterministic adaptive progression evaluator (`src/lib/study-plans/adaptiveProgression.ts`) combining Study Plan DAGs, batched 5D competency projections from `establish-persistent-learner-model`, optional diagnostic outcomes, and `curriculum_node_overrides` (enforcing that `exposure`-only evidence never triggers `demonstrated_prior`).
- [ ] Extend `src/lib/study-plans/generation/{curriculumSchemas,curriculumValidation,coordinator,noAiCoordinator}.ts` to emit provenance and calibrated confidence on AI-inferred edges and enforce `privacyGate.ts` / `is_local_only` / `is_ai_excluded` guards.
- [ ] Extend `src/lib/study-plans/sourceValidation.ts` and `src/lib/study-plans/reading/resolveReadingRange.ts` with deterministic local passage-fingerprint re-anchoring and grounding recovery states (`verified`, `reanchored`, `drifted`, `missing_source`, `converted_ungrounded`).

## 3. UI Surfaces & Learner Controls
- [ ] Update Study Plan Graph view to style `requires` (solid, or dashed when `is_uncertain`) vs `builds_upon` vs filterable associative edges (`related_to`, `example_of`, `contrasts_with`, `applies`, `alternative_explanation_of`).
- [ ] Build prerequisite bypass and edge-correction popover allowing one-click bypass (with optional reason), confirm, retype, reject, and undo.
- [ ] Add optional diagnostic placement banner and `demonstrated_prior` / `ready` / `advisory_blocked` / `needs_grounding_repair` badges in Study Plan workspace with non-destructive skip/reopen controls.
- [ ] Add grounding recovery drawer for `needs_grounding_repair` nodes offering re-anchor, switch to `alternative_explanation_of` source, or explicit conversion to ungrounded note.

## 4. Verification, Benchmarks & Privacy Audits
- [ ] Add Rust unit/integration tests covering migration `172_adaptive_curricula_and_remediation` idempotency, existing Study Plan backward compatibility, `requires` cycle rejection vs associative edge allowance, and bypass/override persistence.
- [ ] Add Vitest unit tests covering TS/Rust topology parity, uncertain AI prerequisite non-blocking behavior, prior-evidence `demonstrated_prior` gating (including `exposure`-only rejection), optional diagnostic dismissal, and grounding recovery on edited/deleted sources.
- [ ] Add automated privacy tests asserting `is_local_only` and `is_ai_excluded` documents never invoke cloud AI during curriculum generation, prerequisite inference, or grounding recovery.
- [ ] Run `src/lib/study-plans/topology.bench.ts` and `npm run bench:check` to verify `O(V + E)` graph validation meets performance budgets.
