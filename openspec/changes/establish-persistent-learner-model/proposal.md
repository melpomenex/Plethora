# Proposal: Establish Persistent Learner Model

## Why

Plethora already stores concepts and typed concept links in `concepts`/`concept_links` (`concept_repository.rs`) and exam-derived evidence in `learning_evidence`/`learning_concept_summaries` (`learning_evidence_repository.rs`). However, the current learner representation is exam-only and collapsed to a single scalar summary:

1. **Missing multi-dimensional competency:** Reading a chapter (`exposure`), explaining a concept in a Socratic check (`comprehension`), recalling a delayed FSRS-7 flashcard (`retention`), solving a worked problem (`application`), and applying the concept in a novel cross-domain transfer task (`transfer`) are fundamentally different learning signals. Collapsing them into one number hides real gaps (e.g., high flashcard recall with zero comprehension or application).
2. **Evidence inflation & false certainty:** Drilling 12 correlated cloze cards generated from a single paragraph can look like "mastery" without correlated-card damping. Conversely, concepts with no evidence must be explicitly represented as `unknown` / `insufficient-evidence` rather than misleadingly shown as `0%` or `50%`.
3. **Siloed evidence & non-retractable state:** FSRS-7 review outcomes, reading exposure, guided reading checks, Socratic formative practice, and learner self-declarations do not flow into one provenance-backed competency model, and invalidating a disputed exam grade or undoing a review does not automatically recompute affected concept dimensions.
4. **Competing UI state:** Legacy `knowledgeGraphStore.ts` and `knowledgeHealthStore.ts` maintain separate `localStorage` heuristics instead of projecting from the canonical SQLite learner model.

## What Changes

1. **SQLite Migration `169_persistent_learner_model`:**
   - Adds `competency_evidence` table storing normalized, provenance-backed, dimension-tagged evidence rows derived from `learning_events` and `learning_evidence` (with `dimension`, `source_kind`, `evidence_group_id`, `card_family_id`, `observed_score`, `base_weight`, `hint_level`, `is_verified`, `is_invalidated`, `invalidated_by_event_id`, `is_local_only`, `is_ai_excluded`).
   - Adds `competency_projections` table storing per-concept 5-dimension competency snapshots (`exposure`, `comprehension`, `retention`, `application`, `transfer`), each with explicit `status` (`unknown` | `insufficient_evidence` | `needs_attention` | `developing` | `demonstrated`), `estimate` (nullable `f64`), `confidence` (`0.0..=1.0`), `effective_evidence_weight`, `independent_groups`, `distinct_days`, `uncertainty_reasons_json`, `last_evidence_at`, and `policy_version`.
   - Adds `learner_competency_declarations` table for explicit user self-assessments (`self_declared` provenance), kept strictly separated from demonstrated evidence.
   - Preserves all existing `concepts`, `concept_links`, `learning_evidence`, `learning_concept_summaries`, `learning_gaps`, and `learning_remediations` tables untouched.
2. **5-Dimension Competency Estimator (Rust + TS Parity):**
   - Extends `src-tauri/src/database/learning_evidence_repository.rs` and `src-tauri/src/models/learning_evidence.rs` (no duplicate repository) with 5D evidence ingestion, correlated-card damping, invalidation/recomputation, and checkpointed consumption of `learning_events`.
   - Adds pure deterministic TypeScript estimator in `src/lib/learner-model/competencyEstimator.ts` with parity tests against Rust so both native desktop/mobile and PWA/Vitest run identical estimation math.
3. **Knowledge Atlas Competency Overlay & Evidence Inspector:**
   - Exposes Tauri commands to fetch a concept's 5D competency profile and its full inspectable provenance trail ("Why does Plethora think I know or don't know this?").
   - Integrates 5D competency overlays and evidence inspection into `KnowledgeAtlasView.tsx` while keeping `concepts`/`concept_links` in `concept_repository.rs` as the canonical graph.

## Capabilities

### New Capabilities
- `persistent-learner-model`: Canonical, provenance-backed 5-dimension competency model (`exposure`, `comprehension`, `retention`, `application`, `transfer`) with correlated-card damping, explicit `unknown` / `insufficient_evidence` states, evidence invalidation/recomputation, manual self-declarations, and Knowledge Atlas evidence inspection.

### Modified Capabilities
- None (existing `learning_evidence_repository.rs` exam-grade ingestion and `concept_repository.rs` graph APIs remain backward compatible and are extended in place).

## Dependencies

- **Upstream:** `unify-learning-state-and-events` (`learning_events` and `learning_event_checkpoints`).
- **Downstream Consumers:** `unify-learning-goals-and-study-plans`, `implement-competency-based-adaptive-curricula`, `unify-assessment-evidence-and-remediation`, `extend-daqe-learning-orchestration`, `implement-personal-learning-coach`.

## Non-Goals

- Replacing FSRS-7 (`src-tauri/src/algorithms/fsrs7/` & `src/algorithms/fsrs7/`) for item-level scheduling; the learner model consumes FSRS-7 review outcomes as *input* to concept-level `retention` and never mutates item intervals.
- Allowing unverified AI assistant chats or `model-only` self-checks to raise demonstrated competency.
- Ingesting biometric or sleep data from `health/health.db`.
- Implementing full adaptive curriculum prerequisite bypass or remediation routing (owned by Phase 3 changes).

## Privacy & Security

- **Local-Only & AI-Excluded Propagation:** Evidence rows inherit `is_local_only` and `is_ai_excluded` from their originating `learning_events` / `documents`. Competency projections computed from any `is_local_only = 1` evidence mark `contains_local_only_evidence = 1` and are never synced in plaintext or via unpermitted sync paths; any cloud AI consumer (e.g., optional coach explanation) receives only a privacy-filtered projection computed exclusively over `is_ai_excluded = 0` evidence.
- **Health Vault Isolation:** Zero references to `health/health.db`.
- **Inspectability & User Control:** Every competency estimate links directly to its underlying `competency_evidence` IDs; users can inspect provenance, retract/dismiss stale evidence, or record an explicit `self_declared` note without corrupting demonstrated history.

## Migration & Backward Compatibility

- Migration `169_persistent_learner_model` is purely additive (`CREATE TABLE IF NOT EXISTS`) and runs transactionally after `168_unify_learning_state_events`.
- Existing `learning_evidence` rows (from prior exams) can be idempotently projected into `competency_evidence` via a resumable reconciliation helper (`reconcile_competency_projections`) without blocking startup.
- Existing `ConceptMasterySummary` consumers continue to work; `learning_concept_summaries` stays synchronized as a backward-compatible rollup view.

## Performance

- Incremental projection updates only the concept IDs touched by new `learning_events` since the `learner_model_v1` checkpoint (typically 1–5 concepts per event), completing in < 2 ms per event.
- Correlated-card damping runs in $O(k \log k)$ per concept where $k$ is the concept's active evidence rows (capped/windowed by recency), keeping recomputation under 5 ms even for heavily drilled concepts with 1,000+ reviews.

## Rollback / Recovery

- `competency_projections` is a purely derived materialized projection over `competency_evidence` and `learning_events`. If estimation weights or damping parameters change (`policy_version` bump), projections can be recomputed deterministically from `competency_evidence` or by resetting the `learner_model_v1` checkpoint.
- Reverting application code leaves all legacy `concepts`, `concept_links`, `learning_evidence`, and `review_results` intact.

## Impact

- **Database:** `src-tauri/src/database/migrations.rs` (migration `169_persistent_learner_model`), extensions to `src-tauri/src/database/learning_evidence_repository.rs`, `src-tauri/src/models/learning_evidence.rs`, and `src-tauri/src/database/concept_repository.rs`.
- **Backend Commands:** `src-tauri/src/commands/learner_model.rs` registered in `src-tauri/src/lib.rs`.
- **Frontend:** `src/lib/learner-model/competencyEstimator.ts`, `src/lib/learner-model/types.ts`, `src/api/learner-model.ts`, Knowledge Atlas overlay & evidence inspector components under `src/components/graph/`.
