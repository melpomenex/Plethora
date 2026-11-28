# Tasks: Establish Persistent Learner Model

## 1. Database Schema & Models
- [ ] Add migration `169_persistent_learner_model` to `src-tauri/src/database/migrations.rs` creating `competency_evidence`, `competency_projections`, `learner_competency_declarations`, and their indexes.
- [ ] Extend `src-tauri/src/models/learning_evidence.rs` with `CompetencyDimension`, `CompetencyStatus`, `CompetencyEvidenceRecord`, `DimensionProjection`, `LearnerCompetencyDeclaration`, and `ConceptCompetencyProfile`.
- [ ] Add Rust migration tests verifying `169_persistent_learner_model` constraints, cascade deletes from `concepts`, and `PRAGMA foreign_key_check`.

## 2. 5-Dimension Estimator & Repository Integration (Rust + TS Parity)
- [ ] Implement the deterministic 5-dimension competency estimator (hint discounting, cramming discount, recency decay, correlated-card damping, explicit `unknown` / `insufficient_evidence` classification) in `src-tauri/src/database/learning_evidence_repository.rs`.
- [ ] Implement `ingest_learning_event_for_competency_tx`, `invalidate_competency_evidence_tx`, `recompute_concept_competency_tx`, `get_concept_competency_profile`, `get_concept_evidence_trail`, `upsert_learner_declaration`, and checkpointed `sync_learner_model_from_events` in `learning_evidence_repository.rs`.
- [ ] Add privacy-filtered query mode (`ai_context: bool`) so cloud AI consumers never see evidence derived from `is_ai_excluded = 1` documents.
- [ ] Implement matching pure TypeScript estimator and types in `src/lib/learner-model/types.ts` and `src/lib/learner-model/competencyEstimator.ts`.
- [ ] Add Tauri commands in `src-tauri/src/commands/learner_model.rs` (`get_concept_competency_profile`, `list_concept_competency_profiles`, `get_concept_evidence_trail`, `set_learner_competency_declaration`, `recompute_learner_model`) and register in `src-tauri/src/lib.rs`.

## 3. Knowledge Atlas Overlay & Evidence Inspector
- [ ] Create `src/api/learner-model.ts` with Tauri invoke + PWA/test local fallback.
- [ ] Add 5-dimension competency overlay and explicit `Unknown` / `Insufficient Evidence` indicators to `src/components/graph/KnowledgeAtlasView.tsx`.
- [ ] Add an Evidence Inspector drawer/panel under `src/components/graph/` displaying per-dimension estimates, confidence, `uncertaintyReasons`, underlying provenance records, and self-declaration controls.

## 4. Verification & Parity Testing
- [ ] Add Rust unit tests in `learning_evidence_repository.rs` covering reading-only exposure, correlated-card damping, delayed retention, unverified AI exclusion, grade/review invalidation recomputation, self-declaration separation, and `ai_context` privacy filtering.
- [ ] Add Vitest parity tests in `src/lib/learner-model/__tests__/competencyEstimator.parity.test.ts` validating Rust/TS mathematical equivalence across golden fixtures.
- [ ] Run `npx tsc --noEmit`, `npx vitest run src/lib/learner-model/`, and `cd src-tauri && cargo test --lib learning_evidence` to verify all checks pass.
