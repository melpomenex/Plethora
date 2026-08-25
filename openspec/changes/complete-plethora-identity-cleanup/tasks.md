# Tasks: Complete Plethora Identity Cleanup

Implementation tasks are arranged in strict dependency order. Each phase must compile and pass tests before proceeding to downstream tasks.

---

## 1. Database & Persistence Layer Migration

- [x] 1.1 Add SQLite migration `086_complete_plethora_identity_migration` to `src-tauri/src/database/migrations.rs`:
  - Rename `arena_state` $\to$ `arena_state`
  - Rename `arena_m2_optimizer` $\to$ `arena_m2_optimizer`
  - Rename `arena_m3_matrices` $\to$ `arena_m3_matrices`
  - Rename `arena_model_params` $\to$ `arena_model_params`
  - Drop obsolete diagnostic tables `precision_matrices`, `precision_recall_cells`, `precision_optimizer_profiles`
  - Update `learning_items.algorithm_type` values (`'adaptive'` $\to$ `'adaptive'`, `'precision'` $\to$ `'precision'`, `'m1'` $\to$ `'classic'`, `'m2'` $\to$ `'classic_5'`, `'m3'` $\to$ `'classic_8'`, `'m4'` $\to$ `'classic_15'`)
- [x] 1.2 Update database repository methods in `src-tauri/src/database/repository.rs`:
  - Rename table queries to `arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`
  - Rename methods (`get_precision_arena` $\to$ `get_arena_state`, `save_precision_arena` $\to$ `save_arena_state`, `get_precision_m3_matrices` $\to$ `get_arena_m3_matrices`, etc.)
  - Update repository tests in `repository.rs`
- [x] 1.3 Update `src-tauri/src/database/priority_rank.rs`, `element_tree_repository.rs`, and `neural_queue_repository.rs`:
  - Sanitize module-level and function-level doc comments to explain queue mechanics directly without third-party brand attributions

---

## 2. Rust Backend Algorithms & Tauri Commands

- [x] 2.1 Rename algorithm files in `src-tauri/src/algorithms/`:
  - `adaptive.rs` $\to$ `adaptive.rs` (`AdaptiveScheduler`, `AdaptiveReviewResult`, `AdaptiveState`)
  - `adaptive_data.rs` $\to$ `adaptive_data.rs`
  - `precision/` directory $\to$ `precision/` (`PrecisionScheduler`, `ArenaState`, `Ensemble`, `KernelModel`, etc.)
  - `classic.rs` (Plethora Classic scheduler) (`ClassicScheduler`, `Classic2State`, `Classic5State`, etc.)
- [x] 2.2 Update `src-tauri/src/algorithms/mod.rs`:
  - Update `AlgorithmType` enum variants (`Fsrs`, `Adaptive`, `Precision`, `Classic`, `Classic5`, `Classic8`, `Classic15`)
  - Update `AlgorithmType::from_str_lossy` to support canonical identifiers and backward-compatible parsing of legacy aliases
  - Update re-exports and module declarations
- [x] 2.3 Update commands in `src-tauri/src/commands/review.rs`, `algorithm.rs`, and `postpone.rs`:
  - Rename Tauri commands:
    - `get_precision_arena_stats` $\to$ `get_arena_stats`
    - `optimize_precision_fsrs` $\to$ `optimize_arena_fsrs`
    - `optimize_precision_m4` $\to$ `optimize_precision_kernel`
    - `get_precision_optimization_status` $\to$ `get_arena_optimization_status`
    - `optimize_precision_locally` $\to$ `optimize_arena_locally`
    - `calculate_classic_next` $\to$ `calculate_classic_next`
  - Sanitize comments in `commands/review.rs`, `commands/queue.rs`, `commands/extract_review.rs`
- [x] 2.4 Update `src-tauri/src/lib.rs`:
  - Update command registrations in `tauri::generate_handler![]`
  - Remove `mod legacy_third_party_import;`

---

## 3. Frontend Core Schedulers, Types & Settings Store

- [x] 3.1 Update `src/lib/schedulerCatalog.ts`:
  - Update `SchedulerId` union: `"fsrs" | "adaptive" | "precision" | "classic" | "classic_5" | "classic_8" | "classic_15"`
  - Update `SCHEDULER_CATALOG` entries with canonical IDs and keys
  - Update `ARENA_MODEL_LABELS` and `ARENA_MODEL_LABEL_ORDER`
- [x] 3.2 Rename and update rating scale modules:
  - Rename `src/lib/rating-grades.ts` $\to$ `src/lib/rating-grades.ts`
  - Update interfaces: `SixGradeDefinition`, `SIX_GRADE_SCALE`, `SixPointGrade` (`0 | 1 | 2 | 3 | 4 | 5`)
  - Update `RatingSchema`: `type: "six-grade" | "four-grade"`
- [x] 3.3 Rename algorithm TypeScript mirrors:
  - Rename `src/lib/adaptiveScheduler.ts` $\to$ `src/lib/adaptiveScheduler.ts`
  - Rename `src/lib/precisionScheduler.ts` $\to$ `src/lib/precisionScheduler.ts`
  - Rename `src/lib/precisionCollection.ts` $\to$ `src/lib/precisionCollection.ts`
- [x] 3.4 Update `src/stores/settingsStore.ts`:
  - Update `LearningSettings`: `algorithm: "fsrs" | "adaptive" | "precision" | "classic" | "classic_5" | "classic_8" | "classic_15"`
  - Rename `precisionPureKernel` $\to$ `precisionPureKernel`
  - Rename `arenaReviewMode` $\to$ `arenaReviewMode`
  - Add hydration migration mapping legacy keys (`"adaptive"` $\to$ `"adaptive"`, `"precision"` $\to$ `"precision"`, etc.)
- [x] 3.5 Update `src/api/review.ts` and `src/api/algorithm.ts`:
  - Update type definitions, interfaces, and invoke calls to new command names (`getArenaStats`, `optimizeArenaFsrs`, `optimizePrecisionKernel`, `getArenaOptimizationStatus`, `calculateClassicNext`)
  - Rename `ArenaPreviewSet` $\to$ `ArenaPreviewSet`, `SixPointGrade` $\to$ `SixPointGrade`
- [x] 3.6 Update `src/lib/browser-backend.ts`:
  - Update mock handlers and storage keys to match canonical algorithm names and commands

---

## 4. Decommission Plethora Import Subsystem

- [x] 4.1 Delete backend import module `src-tauri/src/legacy_third_party_import.rs`.
- [x] 4.2 Delete frontend import utility `src/utils/legacyThirdPartyImport.ts`.
- [x] 4.3 Update `src/components/documents/EnhancedFilePicker.tsx`:
  - Remove `"legacy-third-party"` from `ImportSource` type and import sources array
  - Remove file picker zip filter option
- [x] 4.4 Update `src/routes/documents.tsx`:
  - Remove `source === 'legacy-third-party'` import case and handler
- [x] 4.5 Delete `docs/product/features/imports/legacy-third-party-zip.md`.

---

## 5. UI Components, Review Flows & Knowledge Formulation Refactor

- [x] 5.1 Rename and refactor rating control component:
  - Rename `src/components/review/SixGradeRatingControl.tsx` $\to$ `src/components/review/SixGradeRatingControl.tsx`
  - Update component name to `SixGradeRatingControl`
- [x] 5.2 Update review and queue surfaces to consume `SixGradeRatingControl` and `rating-grades.ts`:
  - `src/components/review/ReviewSession.tsx`
  - `src/components/review/ZenReviewMode.tsx`
  - `src/components/review/FlashcardScrollItem.tsx`
  - `src/components/review/RatingButtons.tsx`
  - `src/pages/QueueScrollPage.tsx`
  - `src/pages/queueScrollKeyboard.ts` (`usesSixGradeKeys`)
  - `src/utils/queueScrollOrder.ts` (sanitize comments and sorting helpers)
- [x] 5.3 Update transparency and inspector panels:
  - `src/components/review/ReviewTransparencyPanel.tsx`
  - `src/components/review/FSRSInspector.tsx`
  - `src/components/review/DeckStatsPanel.tsx`
  - `src/components/review/ItemDetailsPopover.tsx`
  - `src/components/settings/LearningSettings.tsx`
  - `src/routes/settings.tsx`
- [x] 5.4 Neutralize knowledge formulation engine and UI:
  - In `src/lib/ai/knowledgeFormulation.ts`, remove external URLs and personal author names from prompt builders and comments
  - In `src/components/review/FlashcardStudioModal.tsx` and `src/components/tabs/DocumentQATab.tsx`, update labels to `"20 Rules of Knowledge Formulation"`
  - In i18n locales (`en.ts`, `zh.ts`, `es.ts`, `de.ts`, `fr.ts`, `ja.ts`), update `knowledgeFormulation.*`, `settingsLegacy.*`, and `handbook.*` strings

---

## 6. Product Documentation & Help RAG Regeneration

- [x] 6.1 Create Plethora-native feature documentation in `docs/product/features/scheduling/`:
  - Create `adaptive-scheduler.md` (id: `scheduler.adaptive`, title: `Plethora Adaptive Scheduler`)
  - Create `precision-arena.md` (id: `scheduler.precision.arena`, title: `Algorithm Arena`)
  - Create `precision-postpone.md` (id: `scheduler.precision.postpone`, title: `Precision Postpone Engine`)
  - Delete `adaptive-algorithm.md`, `precision-arena.md`, and `precision-postpone.md`
- [x] 6.2 Sanitize remaining product docs in `docs/product/`:
  - Update `docs/product/concepts/incremental-reading.md`
  - Update `docs/product/features/queue/extract-chains.md` (retitle to `Hierarchical Extract Chains`)
  - Update `docs/product/features/media/rss-queue.md`
  - Update `docs/product/features/queue/priority-system.md`
  - Update `docs/product/schema.json`
- [x] 6.3 Update `scripts/docs-coverage.mjs` with new feature IDs and code references.
- [x] 6.4 Run `node scripts/build-help-index.mjs` to regenerate `src/features/help/generated/helpIndex.json` and `helpIndexData.ts`.
- [x] 6.5 Sanitize repository-level overview docs:
  - `README.md` (remove legacy third-party collection import lines)
  - `docs/PROJECT_SUMMARY.md`
  - `docs/FEATURES_IMPLEMENTED.md`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `docs/release/PLETHORA_1_0_RC_FINDINGS.md`
  - `CHANGELOG.md`

---

## 7. Test Suite, Fixtures, Benchmarks & Performance Gate

- [x] 7.1 Rename and update test files:
  - `src/lib/__tests__/adaptiveScheduler.test.ts` $\to$ `adaptiveScheduler.test.ts`
  - `src/lib/__tests__/precisionScheduler.test.ts` $\to$ `precisionScheduler.test.ts`
  - `src/lib/__tests__/browserBackendPrecisionCollection.test.ts` $\to$ `browserBackendPrecisionCollection.test.ts`
  - `src/lib/__tests__/rating-grades.test.ts` $\to$ `ratingGrades.test.ts`
  - `src/components/review/__tests__/SixGradeRatingControl.matrix.test.tsx` $\to$ `SixGradeRatingControl.matrix.test.tsx`
  - `src/pages/__tests__/queueScrollKeyboard.test.ts`
  - `src/stores/__tests__/reviewStore.test.ts`
  - `src/stores/__tests__/settingsStore.test.ts`
  - `src/lib/__tests__/schedulerCatalog.test.ts`
  - `src/__tests__/schedulerNaming.test.ts`
- [x] 7.2 Rename test fixture:
  - `src/shared/arenaParityFixture.json` $\to$ `src/shared/arenaParityFixture.json`
- [x] 7.3 Rename benchmark and update `scripts/perf-baselines.json`:
  - Rename `src/lib/precision.bench.ts` $\to$ `src/lib/precision.bench.ts`
  - Rename benchmark name to `"precision-scheduler/review-sequence"`
  - Update `scripts/perf-baselines.json` with new benchmark key and clean reason strings
- [x] 7.4 Update Rust backend tests in `src-tauri/src/algorithms/tests.rs` and `src-tauri/src/database/repository.rs`.

---

## 8. OpenSpec Change History & Specs Sanitization

- [x] 8.1 Sanitize requirements and Gherkin scenarios in active OpenSpec specs:
  - `openspec/specs/postpone-engine/spec.md`
  - `openspec/specs/postpone-settings/spec.md`
  - `openspec/specs/document-rating/spec.md`
- [x] 8.2 Sanitize or archive legacy completed change directories in `openspec/changes/`:
  - `fix-legacy-third-party-zip-import/`
  - `unified-priority-queue/`
  - `unified-rating-ux/`
  - `add-adaptive-algorithm-selector/`
  - `add-adaptive-algorithm-transparency/`
  - `fix-precision-activation/`
  - `fix-precision-algorithm/`
  - `update-precision-algorithm/`

---

## 9. Verification & Search Gate

- [x] 9.1 Execute zero-reference content search (must return 0 results):
  ```bash
  git grep -ni "legacy-third-party"
  git grep -ni "legacy third-party product name"
  git grep -niE '\bsm[-_ ]?18\b'
  git grep -niE '\bsm[-_ ]?20\b'
  git grep -niE '\bsm[-_ ]?15\b'
  git grep -niE '\bsm[-_ ]?19\b'
  git grep -ni "legacy stability matrix data"
  git grep -ni "super-memory\.com"
  git grep -ni "legacy-third-party\.guru"
  ```
- [x] 9.2 Execute zero-reference filename search (must return 0 results):
  ```bash
  git ls-files | grep -i 'legacy-third-party'
  git ls-files | grep -Ei 'sm[-_ ]?18|sm[-_ ]?20'
  ```
- [x] 9.3 Run full test and build validation suites:
  - `npm run typecheck`
  - `npm run test`
  - `npm run bench:check`
  - `npm run test:scripts`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `node scripts/docs-validate.mjs`
  - `node scripts/docs-coverage.mjs`
