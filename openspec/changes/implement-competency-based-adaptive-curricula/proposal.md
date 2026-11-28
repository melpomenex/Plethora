# Proposal: Implement Competency-Based Adaptive Curricula

## Why

Plethora's existing Study Plans (`study_plan_repository.rs`, `src/lib/study-plans/topology.ts`, `src/lib/study-plans/graph/*`) support versioned curricula, Sugiyama DAG rendering, and source-grounded nodes, but they still behave like static linear-or-DAG syllabi rather than competency-based adaptive curricula:

1. **Coarse prerequisite semantics:** Prerequisite links currently express only a binary dependency edge without distinguishing strict prerequisites (`requires`) from conceptual scaffolding (`builds_upon`), lateral links (`related_to`), illustrations (`example_of`), comparisons (`contrasts_with`), practical uses (`applies`), or remedial/alternate perspectives (`alternative_explanation_of`).
2. **Brittle AI-inferred prerequisites:** When an AI-generated curriculum infers a prerequisite edge with low confidence or imperfect domain structure, treating it as a hard gate can unnecessarily block a learner who already knows the concept or disagrees with the edge.
3. **No prior-evidence reuse or diagnostic placement:** Learners who have already demonstrated competency on a concept in another Learning Goal, exam, or long-term FSRS review history are still forced through redundant introductory steps unless they manually mark items complete.
4. **Fragile source grounding over time:** If a source document is edited, re-indexed, moved, or deleted after a curriculum is published, grounded node anchors need deterministic verification and non-destructive recovery rather than broken links or silent ungrounded hallucinations.

## What Changes

- **Rich typed conceptual relationships:** Extend curriculum edge storage and graph projection to support seven typed relationship kinds: `requires`, `builds_upon`, `related_to`, `example_of`, `contrasts_with`, `applies`, and `alternative_explanation_of`, while enforcing acyclicity strictly on `requires` edges.
- **Edge provenance, uncertainty, and non-blocking bypass:** Attach provenance (`manual`, `source_explicit`, `ai_inferred`, `imported`), confidence (`0.0..=1.0`), uncertainty indicators, and optional source anchor references to curriculum relationships. Uncertain or AI-inferred `requires` edges NEVER permanently block progression; learners can bypass with a recorded reason or correct/retype/remove the edge.
- **Optional diagnostic placement and non-destructive adaptive progression:** Support an optional diagnostic placement flow and automatic reuse of verified 5-dimension competency evidence from the persistent learner model (`establish-persistent-learner-model`) to recommend skipping or compacting already-demonstrated nodes (`demonstrated_prior`) without deleting nodes, history, or manual overrides.
- **Deterministic grounding verification and recovery:** Verify passage/anchor resolution against `study_source_repository.rs` and `resolveReadingRange.ts` for all source-grounded curriculum nodes and guided trails; surface stale/missing anchors with guided re-anchoring or alternate-source fallback while enforcing `is_local_only` / `is_ai_excluded` boundaries.
- **SQLite migration `172_adaptive_curricula_and_remediation`:** Add additive, transactional schema support for typed curriculum relationships, provenance/uncertainty metadata, learner bypass/correction records, adaptive node progression overlays, and grounding verification state (coordinated with `unify-assessment-evidence-and-remediation`).

## Capabilities

### New Capabilities

- `competency-adaptive-curricula`: Typed conceptual relationship graphs, provenance/uncertainty tracking, non-blocking prerequisite bypass and edge correction, diagnostic placement and prior-evidence adaptive progression, and source-grounding recovery for Study Plans and Learning Goals.

### Modified Capabilities

- None (extends existing `study_plan_repository.rs`, `src/lib/study-plans/topology.ts`, `src/lib/study-plans/graph/*`, `src/lib/study-plans/reading/*`, and `src/lib/study-plans/generation/*` additively).

## Dependencies

- `establish-persistent-learner-model` (Phase 1): Provides canonical 5-dimension competency projections (`exposure`, `comprehension`, `retention`, `application`, `transfer`) and evidence provenance used for prior-evidence detection and adaptive progression.
- `unify-learning-goals-and-study-plans` (Phase 1): Provides unified `learning_goals` linked optionally to `study_plans.id` so prior evidence and adaptive progression operate cleanly across goals.
- Coordinates SQLite migration `172_adaptive_curricula_and_remediation` with `unify-assessment-evidence-and-remediation` (Phase 3).

## Non-Goals

- Replacing FSRS-7 (`src-tauri/src/algorithms/fsrs7/`) as the authoritative item-level spaced-repetition scheduler.
- Mandatory diagnostic testing before a learner can read or study a curriculum (diagnostics are always optional).
- Automatic silent deletion of study plan nodes or historical progress when adaptive progression marks a concept as already demonstrated.
- Sending `is_local_only` or `is_ai_excluded` documents to cloud AI models for prerequisite inference or grounding repair.

## Privacy & Security

- All source-grounded curriculum generation, prerequisite inference, and grounding recovery MUST pass through `src-tauri/src/database/document_privacy.rs` and `src/lib/ai/assistant/privacyGate.ts`.
- Documents marked `is_local_only` or `is_ai_excluded` MUST never be transmitted to cloud AI or cloud embedding endpoints; local-only curricula degrade gracefully to deterministic structural/no-AI analysis (`noAiCoordinator.ts`) or on-device local models when explicitly enabled.
- Health Vault (`health/health.db`) remains physically isolated and is never queried by curriculum progression, prerequisite inference, or diagnostic placement.
- All learner bypasses, edge corrections, and adaptive state overlays are stored locally in SQLite and synced via `journal_entity` only when sync is enabled and privacy flags permit.

## Migration & Backward Compatibility

- Migration `172_adaptive_curricula_and_remediation` is additive, transactional, and idempotent.
- Existing rows in `study_plan_prerequisites` (or versioned prerequisite edges) default to `relationship_type = 'requires'`, `provenance = 'imported'` (or `'manual'` where user-authored), `confidence = 1.0`, and `is_uncertain = 0`, preserving 100% of existing Study Plans, versions, and DAG layouts.
- Existing `topology.ts` callers that expect a DAG over `requires` edges continue to receive identical deterministic topological ordering.

## Performance

- Cycle detection and topological ordering in `src/lib/study-plans/topology.ts` and Rust repository validation remain `O(V + E)` over the `requires` subgraph, completing in `< 5ms` for plans up to 500 nodes and 2,000 edges (verified via `src/lib/study-plans/topology.bench.ts` and `npm run bench:check`).
- Adaptive progression overlay evaluation queries indexed `competency_projections` in a single batched lookup per plan load rather than N+1 per-node queries.
- Grounding verification checks run lazily on open/edit or batched in background workers without blocking UI frame rendering.

## Rollback / Recovery

- All schema additions in migration `172_adaptive_curricula_and_remediation` are additive tables/columns; existing Study Plan tables and immutable plan versions remain untouched.
- If adaptive progression is disabled by the learner or reverted, the curriculum falls back cleanly to its canonical published topological order with zero data loss.
- Learner bypasses and edge corrections are reversible audit records; resetting a bypass or adaptive skip restores the node to active status immediately.

## Impact

- **Backend (Rust/SQLite):** `src-tauri/src/database/migrations.rs` (`172_adaptive_curricula_and_remediation`), `src-tauri/src/database/study_plan_repository.rs`, `src-tauri/src/database/study_source_repository.rs`, `src-tauri/src/commands/study_plans.rs`.
- **Frontend Domain:** `src/lib/study-plans/topology.ts`, `src/lib/study-plans/graph/{types,projection,layout,traversal}.ts`, `src/lib/study-plans/generation/{curriculumSchemas,curriculumValidation,coordinator,noAiCoordinator}.ts`, `src/lib/study-plans/reading/{resolveReadingRange,trailController}.ts`, `src/lib/study-plans/sourceValidation.ts`.
- **UI:** Study Plan Graph edge styling/filtering, prerequisite bypass & correction popover, optional diagnostic placement banner, adaptive progression status badges, and stale-anchor grounding recovery drawer.
