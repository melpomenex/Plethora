# Plethora Identity & Architecture Cleanup: Elimination of Third-Party SRS Nomenclature

## Why

Plethora is a comprehensive, multi-platform personal learning operating system featuring document reading, knowledge formulation, multi-engine text-to-speech, and spaced repetition scheduling. Historically, portions of the codebase, documentation, internal type definitions, database values, and user interfaces inherited branded nomenclature, filenames, attribution, and implementation artifacts from legacy third-party SRS products (including terms such as `Plethora`, `Adaptive`, `Precision`, `Classic`, `Classic15`, `Classic19`, legacy stability-matrix data files, and related third-party references).

While earlier brand-consolidation passes updated high-level UI labels to product names ("Plethora Classic", "Plethora Adaptive", "Plethora Precision"), the underlying codebase still harbors extensive legacy branding:
1. **Source Identifiers and Components**: Files and symbols such as `src/lib/rating-grades.ts`, `SixGradeRatingControl.tsx`, `src-tauri/src/algorithms/classic.rs`, `src-tauri/src/algorithms/adaptive.rs`, and `src-tauri/src/algorithms/precision/` expose third-party names to active development.
2. **Product Documentation & RAG Corpus**: Dedicated markdown documents such as `docs/product/features/scheduling/adaptive-algorithm.md`, `docs/product/features/scheduling/precision-postpone.md`, and `docs/product/features/imports/legacy-third-party-zip.md` teach third-party algorithm provenance and are ingested into the "Ask Plethora" help search index (`helpIndex.json`), causing product help queries to return third-party explanations.
3. **Dedicated Migration/Import Subsystems**: `src/utils/legacyThirdPartyImport.ts` and `src-tauri/src/legacy_third_party_import.rs` implement a proprietary XML zip parser solely for migrating collections from a legacy commercial software package.
4. **Database & Serialization Compatibility Literals**: SQLite records in `learning_items.algorithm_type` store literal strings (`"adaptive"`, `"precision"`, `"m1"`, etc.), and SQLite tables are named `arena_state`, `arena_m2_optimizer`, etc.
5. **Code Comments & Attribution**: Active algorithms, queues, and priority formulas contain misleading commentary attributing internal Plethora logic to third-party software rather than explaining the mathematical and cognitive mechanics directly.

This proposal establishes a **permanent, Plethora-native architecture** that cleanly eliminates all third-party third-party SRS branding, terminology, documentation, and implementation-facing naming while **preserving 100% of Plethora's working scheduling mathematics, user review data, and desktop/mobile UX**.

---

## Goals

1. **Zero Unintended References**: Ensure that a repository-wide case-insensitive audit for `legacy-third-party`, legacy third-party product names, `adaptive`, `precision`, `classic_15`, `classic_19`, and related terms yields zero unintended occurrences across active source, comments, tests, benchmarks, docs, and assets.
2. **True Domain Abstraction (No Blind Global Swapping)**: Replace third-party identifiers with genuine, behavior-focused domain abstractions (e.g., `SixGradeRatingControl`, `rating-grades.ts`, `AdaptiveScheduler`, `PrecisionScheduler`, `ClassicScheduler`), explicitly avoiding fake trademark substitutions (e.g., *never* invent "Plethora 18" or "Plethora 20").
3. **Safe, Lossless Persistence Migration**: Introduce an automatic SQLite schema and data migration (along with frontend settings store migration) that maps legacy `algorithm_type` identifiers (`"adaptive"`, `"precision"`, `"m1"`, etc.) to canonical Plethora identifiers (`"adaptive"`, `"precision"`, `"classic"`, etc.) with zero data loss or preference reset for existing users.
4. **Clean Removal of Dedicated Plethora Import**: Fully remove the legacy legacy third-party collection XML/ZIP import feature (backend parser, Tauri commands, frontend utility, file picker option, route handling, and docs) without affecting independent import formats (Anki `.apkg`, Kindle clippings, Markdown directory, JSON deck, RSS, URL).
5. **Plethora-Centric Documentation & RAG Help System**: Delete obsolete third-party algorithm docs; replace them with genuine Plethora-native feature documentation describing Plethora's actual scheduling behavior, queue mechanics, and postponement policies; regenerate `helpIndex.json` and `helpIndexData.ts` to ensure "Ask Plethora" answers questions using pure Plethora documentation.
6. **Unified Six-Grade Rating Architecture**: Preserve the full 0–5 rating capability (touch joystick and 6-button desktop grid) for adaptive and precision schedulers under a neutral `SixGradeRatingControl` abstraction.
7. **Clean OpenSpec Repository Footprint**: Cleanse or archive historical OpenSpec artifacts so the checked-out repository tree contains no lingering legacy terminology.

---

## Non-Goals

1. **Altering Spaced-Repetition Mathematics**: We are not changing the mathematical formulations of the 3D SInc interpolation matrix, the 5-model Algorithm Arena ensemble, the classic EF interval formulas, or the FSRS-6 engine. Their computation remains mathematically identical.
2. **Rewriting Git Commit History**: This change applies strictly to the current checked-out repository files, documentation, databases, and assets. Git historical commit messages are preserved as immutable version-control history.
3. **Modifying Third-Party Open Standards (FSRS)**: FSRS is an open-source, community-developed spaced repetition algorithm. FSRS-6 identifiers and naming remain intact and are not rebranded as Plethora inventions.
4. **Removing General Cognitive Science / Incremental Reading Concepts**: Concepts such as "Incremental Reading", "Extract Chains", "Priority Queue", "Knowledge Formulation Rules", "Active Recall", and "Cloze Deletion" are universal domain concepts and remain central to Plethora, freed from proprietary product attribution.

---

## Complete Audit & Findings

A comprehensive repository audit classified all discovered references into 12 concrete categories:

| Category | Discovered Locations | Action & Target Abstraction |
| :--- | :--- | :--- |
| **1. User-Visible Branding & UI** | `LearningSettings.tsx`, `ReviewTransparencyPanel.tsx`, `FSRSInspector.tsx`, `DeckStatsPanel.tsx`, `ItemDetailsPopover.tsx`, `FlashcardStudioModal.tsx`, `DocumentQATab.tsx` | All display labels already consume or will consume `SCHEDULER_CATALOG` (`"Plethora Classic"`, `"Plethora Adaptive"`, `"Plethora Precision"`, `"FSRS-6"`). Remove legacy labels and Dr. Wozniak name in formulation tools in favor of `"20 Rules of Knowledge Formulation"`. |
| **2. Product Documentation** | `docs/product/features/scheduling/adaptive-algorithm.md`, `precision-postpone.md`, `precision-arena.md`, `imports/legacy-third-party-zip.md`, `concepts/incremental-reading.md`, `queue/extract-chains.md` | Delete `adaptive-algorithm.md` and `legacy-third-party-zip.md`. Replace with `docs/product/features/scheduling/adaptive-scheduler.md`, `precision-scheduler.md`, `precision-postpone.md`, and clean `extract-chains.md` / `incremental-reading.md`. |
| **3. Internal Source Identifiers** | `src/lib/rating-grades.ts`, `src/components/review/SixGradeRatingControl.tsx`, `src/utils/queueScrollOrder.ts`, `src/pages/queueScrollKeyboard.ts` | Rename to `src/lib/rating-grades.ts`, `SixGradeRatingControl.tsx`, `usesSixGradeKeys`, `RatingSchema.type = "six-grade" \| "four-grade"`, `SIX_GRADE_SCALE`. |
| **4. Scheduler & Algorithm Engines** | `src-tauri/src/algorithms/classic.rs`, `adaptive.rs`, `adaptive_data.rs`, `precision/`, `src/lib/adaptiveScheduler.ts`, `precisionScheduler.ts`, `precisionCollection.ts` | Rename to `src-tauri/src/algorithms/classic.rs`, `adaptive.rs`, `adaptive_data.rs`, `precision/` (`arena.rs`, `kernel.rs`, etc.), `src/lib/adaptiveScheduler.ts`, `precisionScheduler.ts`, `precisionCollection.ts`. |
| **5. Persistent Database & Settings** | SQLite `learning_items.algorithm_type`, `arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`, `settingsStore.learning.algorithm`, `precisionPureKernel`, `arenaReviewMode` | Schema migration `086_complete_plethora_identity_migration`: update `algorithm_type` values (`adaptive` $\to$ `adaptive`, `precision` $\to$ `precision`, `classic` $\to$ `classic`), rename tables (`arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`), migrate settings keys to `precisionPureKernel`, `arenaReviewMode`. |
| **6. Import/Export Subsystem** | `src-tauri/src/legacy_third_party_import.rs`, `src/utils/legacyThirdPartyImport.ts`, `EnhancedFilePicker.tsx`, `src/routes/documents.tsx`, `src-tauri/src/lib.rs` | **Complete removal**: Delete Rust parser and TS utility; remove `import_legacy_third_party_package` and `validate_legacy_third_party_package` commands; remove `"legacy-third-party"` from `ImportSource` and file picker filters; drop `legacy-third-party://` protocol references. |
| **7. Tests, Fixtures & Benchmarks** | `adaptiveScheduler.test.ts`, `precisionScheduler.test.ts`, `rating-grades.test.ts`, `SixGradeRatingControl.matrix.test.tsx`, `arenaParityFixture.json`, `precision.bench.ts`, `scripts/perf-baselines.json` | Rename tests to `adaptiveScheduler.test.ts`, `precisionScheduler.test.ts`, `ratingGrades.test.ts`, `SixGradeRatingControl.matrix.test.tsx`, fixture `arenaParityFixture.json`, benchmark `precision.bench.ts` (`precision-scheduler/review-sequence`), update `perf-baselines.json`. |
| **8. Comments & Developer Docs** | `src-tauri/src/commands/review.rs`, `queue.rs`, `postpone.rs`, `priority_rank.rs`, `element_tree_repository.rs`, `src/utils/queueScrollOrder.ts` | Rewrite comments to explain the underlying logic (e.g., "Combines primary priority rank with stable hash jitter to inject session variety", "Hierarchical element tree with sibling pointers for extract provenance"). |
| **9. Current OpenSpec Specs** | `openspec/specs/postpone-engine/`, `specs/document-rating/`, `specs/scheduler-catalog/` | Sanitize any residual Plethora Adaptive/Plethora Precision/Plethora strings in active specification requirements and scenarios. |
| **10. OpenSpec Change History** | `openspec/changes/fix-legacy-third-party-zip-import/`, `unified-priority-queue/`, `unified-rating-ux/`, `add-adaptive-*`, `fix-precision-*` | Sanitize or archive completed change directories under neutral naming (`legacy-rating-ux`, `unified-priority-queue`, etc.) so active search tools find no stale branding. |
| **11. Generated Indexes & Scripts** | `scripts/build-help-index.mjs`, `scripts/docs-coverage.mjs`, `src/features/help/generated/helpIndex.json`, `helpIndexData.ts` | Update `docs-coverage.mjs` feature IDs (`scheduler.adaptive`, `scheduler.precision.arena`, `scheduler.precision.postpone`); re-run `build-help-index.mjs` to produce clean JSON and TypeScript indexes. |
| **12. External URLs & Citations** | `third-party SRS site`, `third-party SRS documentation`, decompilation links in code headers | Remove all third-party website links and decompilation notes; replace with direct, clean mathematical documentation. |

---

## Canonical Nomenclature & Terminology Mapping

| Old Identifier / Name | Canonical Plethora Identifier | User-Facing Product Name | Description & Domain Role |
| :--- | :--- | :--- | :--- |
| `adaptive` / `Adaptive` / `Plethora Adaptive` | `adaptive` | **Plethora Adaptive** | Spaced repetition scheduler using a continuous 3-dimensional stability increase interpolation matrix across Difficulty, Stability, and Retrievability. |
| `precision` / `Precision` / `Plethora Precision` | `precision` | **Plethora Precision** | Spaced repetition scheduler powered by an Algorithm Arena multi-model ensemble (kernel model, Bayesian matrix updates, and adaptive per-user model weighting). |
| `classic` / `Classic` / `Plethora Classic` | `classic` | **Plethora Classic** | Classical factor-based interval growth scheduler with ease factor adjustment. |
| `classic_5` / `classic_8` / `classic_15` | `classic_5` / `classic_8` / `classic_15` | **Plethora Classic (Legacy N)** | Historical baseline interval algorithms used for research and arena comparison. |
| `fsrs` | `fsrs` | **FSRS-6** | Modern third-party power-curve spaced repetition scheduler (preserved as-is). |
| `rating-grades.ts` | `rating-grades.ts` | — | Single source of truth for the 6-point (0–5) and 4-point (1–4) grading scales. |
| `SixGradeRatingControl` | `SixGradeRatingControl` | — | UI component rendering touch joystick and 6-button grid for 6-grade schedulers. |
| `SixGradeDefinition` | `SixGradeDefinition` | — | Definition for grades 0 through 5. |
| `SIX_GRADE_SCALE` | `SIX_GRADE_SCALE` | — | Constant array of six rating grade definitions. |
| `SIX_GRADE_RATING_SCHEMA` | `SIX_GRADE_RATING_SCHEMA` | — | Rating schema identifier (`type: "six-grade"`). |
| `precisionPureKernel` | `precisionPureKernel` | — | Settings toggle for using the direct 35-parameter theoretical kernel without ensemble blending. |
| `arenaReviewMode` | `arenaReviewMode` | — | Settings toggle for automatic vs. manual candidate interval selection. |

---

## Capabilities

### New Capabilities
- `plethora-identity-governance`: Repository-level validation and CI checks enforcing zero occurrences of third-party SRS trademarks, legacy algorithm acronyms, or external attribution links.
- `database-identity-migration`: Automated SQLite schema migration translating legacy algorithm types and table names to canonical Plethora identifiers during app startup.

### Modified Capabilities
- `scheduler-catalog`: Updated registry mapping canonical IDs (`fsrs`, `adaptive`, `precision`, `classic`, `classic_5`, `classic_8`, `classic_15`) to user-facing labels and behavior-focused descriptions.
- `flashcard-review-session`: Consumes neutral `rating-grades` and `SixGradeRatingControl` without changing rating physics or keyboard handling.
- `canonical-product-documentation`: Replaced third-party algorithm guides with canonical documentation for Plethora Adaptive and Plethora Precision.

---

## Impact

- **Frontend**: `src/lib/schedulerCatalog.ts`, `src/lib/rating-grades.ts`, `src/components/review/SixGradeRatingControl.tsx`, `ReviewSession.tsx`, `ZenReviewMode.tsx`, `FlashcardScrollItem.tsx`, `ReviewTransparencyPanel.tsx`, `FSRSInspector.tsx`, `LearningSettings.tsx`, `useRatingJoystick.ts`, `queueScrollKeyboard.ts`, `browser-backend.ts`, `settingsStore.ts`.
- **Rust Backend**: `src-tauri/src/algorithms/mod.rs`, `adaptive.rs`, `adaptive_data.rs`, `precision/` module, `classic.rs`, `commands/review.rs`, `commands/algorithm.rs`, `commands/postpone.rs`, `database/repository.rs`, `database/migrations.rs`, `lib.rs`.
- **Database**: SQLite migration `086_complete_plethora_identity_migration` updates `learning_items` records and table names.
- **Documentation**: `docs/product/` updated, `docs-coverage.mjs` aligned, `helpIndex.json` and `helpIndexData.ts` regenerated.
- **Removed Code**: `src-tauri/src/legacy_third_party_import.rs`, `src/utils/legacyThirdPartyImport.ts`, `docs/product/features/imports/legacy-third-party-zip.md`, legacy import commands and UI handlers.
