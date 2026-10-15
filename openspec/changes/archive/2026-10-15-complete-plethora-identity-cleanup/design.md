# Architecture & Design: Plethora Identity & Domain Neutralization

This document details the exact architectural refactoring, migration strategy, file movements, schema updates, API adaptations, and validation gates for eliminating third-party SRS nomenclature from Plethora.

---

## 1. Design Principles & Strategy

1. **Behavioral Fidelity Over Provenance**: Plethora's schedulers, priority queues, postponement logic, and 6-grade controls represent sophisticated, proven cognitive tools. We preserve their mathematics, data models, and user experiences completely while decoupling them from third-party branding.
2. **Honest Domain Abstractions**: Components and files are named after *what they do* (e.g., `SixGradeRatingControl`, `AdaptiveScheduler`, `PrecisionScheduler`, `rating-grades.ts`), never after synthetic mock trademarks (e.g., no "Plethora 18").
3. **Lossless, Automatic Migration**: Upgrading an existing database or settings profile must seamlessly migrate user data without resetting algorithm choices, losing review history, or corrupting state blobs.
4. **Complete Tree Cleanliness**: The end state must achieve zero occurrences of banned terms across code, paths, comments, tests, benchmarks, docs, and search manifests.

---

## 2. Scheduler Subsystem Architecture & Module Movements

### 2.1 Rust Backend (`src-tauri/src/algorithms/`)

```
src-tauri/src/algorithms/
├── mod.rs                        # Updated AlgorithmType enum & re-exports
├── adaptive.rs                   # Plethora Adaptive scheduler (3D SInc matrix)
├── adaptive_data.rs              # Static matrix constant tables for adaptive scheduler
├── precision/                    # Plethora Precision scheduler kernel & arena
│   ├── mod.rs                    # Precision scheduler & Algorithm Arena entry point
│   ├── arena.rs                  # Multi-model weight adaptation & candidate selection
│   ├── ensemble.rs               # Ensemble interval computation
│   ├── kernel.rs                 # 35-parameter theoretical memory model
│   ├── model1.rs                 # Classic component (M1)
│   ├── model2.rs                 # Optimized factor component (M2)
│   ├── model3.rs                 # 21³ Bayesian matrix component (M3)
│   ├── model5.rs                 # Power curve component (M5)
│   ├── helpers.rs                # Math utilities & bounds clamping
│   └── optimize.rs               # Per-user parameter fitting
├── classic.rs                    # Plethora Classic factor algorithms (2/5/8/15)
├── document_scheduler.rs         # Incremental reading scheduler
├── incremental_scheduler.rs      # Topic-based interval progression
├── neural_queue.rs               # Spreading-activation associative queue
├── postpone.rs                   # Priority-aware backlog postponement
├── priority_queue.rs             # Position-based unified queue rank
├── queue_selector.rs             # Weighted randomization queue builder
└── relevance.rs                  # Semantic relevance scoring
```

#### Rust `AlgorithmType` Definition (`src-tauri/src/algorithms/mod.rs`):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AlgorithmType {
    #[default]
    Fsrs,
    Adaptive,
    Precision,
    Classic,
    Classic5,
    Classic8,
    Classic15,
}

impl AlgorithmType {
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "fsrs" => AlgorithmType::Fsrs,
            "adaptive" | "legacy-adaptive-id" => AlgorithmType::Adaptive,
            "precision" | "legacy-precision-id" => AlgorithmType::Precision,
            "classic" | "m1" => AlgorithmType::Classic,
            "classic_5" | "m2" => AlgorithmType::Classic5,
            "classic_8" | "m3" => AlgorithmType::Classic8,
            "classic_15" | "m4" => AlgorithmType::Classic15,
            _ => AlgorithmType::Fsrs,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AlgorithmType::Fsrs => "fsrs",
            AlgorithmType::Adaptive => "adaptive",
            AlgorithmType::Precision => "precision",
            AlgorithmType::Classic => "classic",
            AlgorithmType::Classic5 => "classic_5",
            AlgorithmType::Classic8 => "classic_8",
            AlgorithmType::Classic15 => "classic_15",
        }
    }
}
```

### 2.2 Frontend TypeScript Architecture (`src/lib/`)

```
src/lib/
├── schedulerCatalog.ts           # Central metadata registry for UI
├── rating-grades.ts              # Renamed from rating-grades.ts (0-5 & 1-4 grade scales)
├── adaptiveScheduler.ts          # TS mirror of Plethora Adaptive 3D SInc engine
├── precisionScheduler.ts         # TS mirror of precision kernel & arena
├── precisionCollection.ts        # Collection-wide precision matrix state
├── browser-backend.ts            # Web/mock backend implementation updated to new names
└── ...
```

#### Frontend `schedulerCatalog.ts` Updates:
```typescript
export type SchedulerId = "fsrs" | "adaptive" | "precision" | "classic" | "classic_5" | "classic_8" | "classic_15";

export interface SchedulerInfo {
  id: SchedulerId;
  label: string;
  shortLabel: string;
  descriptionKey: string;
  thirdParty: boolean;
}

export const SCHEDULER_CATALOG: Record<SchedulerId, SchedulerInfo> = {
  fsrs: {
    id: "fsrs",
    label: "FSRS-6",
    shortLabel: "FSRS-6",
    descriptionKey: "learningSettings.fsrsDesc",
    thirdParty: true,
  },
  adaptive: {
    id: "adaptive",
    label: "Plethora Adaptive",
    shortLabel: "Adaptive",
    descriptionKey: "learningSettings.adaptiveDesc",
    thirdParty: false,
  },
  precision: {
    id: "precision",
    label: "Plethora Precision",
    shortLabel: "Precision",
    descriptionKey: "learningSettings.precisionDesc",
    thirdParty: false,
  },
  classic: {
    id: "classic",
    label: "Plethora Classic",
    shortLabel: "Classic",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_5: {
    id: "classic_5",
    label: "Plethora Classic 5",
    shortLabel: "Classic 5",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_8: {
    id: "classic_8",
    label: "Plethora Classic 8",
    shortLabel: "Classic 8",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_15: {
    id: "classic_15",
    label: "Plethora Classic 15",
    shortLabel: "Classic 15",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
};
```

---

## 3. Rating Scale & Review Controls Refactor

### 3.1 Neutral Rating Types (`src/lib/rating-grades.ts`)

Rename `src/lib/rating-grades.ts` $\to$ `src/lib/rating-grades.ts`:
- Replace `SixGradeDefinition` $\to$ `SixGradeDefinition`.
- Replace `SIX_GRADE_SCALE` $\to$ `SIX_GRADE_SCALE`.
- Replace `SixPointGrade` $\to$ `SixPointGrade` (`0 | 1 | 2 | 3 | 4 | 5`).
- Update `RatingSchema`:
  ```typescript
  export interface RatingSchema {
    type: "six-grade" | "four-grade";
    grades: number[];
  }

  export const SIX_GRADE_RATING_SCHEMA: RatingSchema = {
    type: "six-grade",
    grades: [0, 1, 2, 3, 4, 5],
  };

  export const FOUR_GRADE_RATING_SCHEMA: RatingSchema = {
    type: "four-grade",
    grades: [1, 2, 3, 4],
  };

  export function getRatingSchema(algorithm: LearningSettings["algorithm"] | undefined): RatingSchema {
    return algorithm === "adaptive" || algorithm === "precision" || algorithm === "legacy-adaptive-id" || algorithm === "legacy-precision-id"
      ? SIX_GRADE_RATING_SCHEMA
      : FOUR_GRADE_RATING_SCHEMA;
  }
  ```

### 3.2 Rating Component (`src/components/review/SixGradeRatingControl.tsx`)

Rename `SixGradeRatingControl.tsx` $\to$ `SixGradeRatingControl.tsx`:
- Export `SixGradeRatingControl` and `useIsTouchRating`.
- Internal helper `TouchPlethoraRating` $\to$ `TouchSixGradeRating`.
- Consumed by `ReviewSession.tsx`, `ZenReviewMode.tsx`, `FlashcardScrollItem.tsx`, and `QueueScrollPage.tsx`.

---

## 4. Database Schema, Persistence & Settings Migration

### 4.1 SQLite Schema & Data Migration (`086_complete_plethora_identity_migration`)

Add migration 086 to `src-tauri/src/database/migrations.rs`:
```sql
-- 1. Migrate table names
ALTER TABLE arena_state RENAME TO arena_state;
ALTER TABLE arena_m2_optimizer RENAME TO arena_m2_optimizer;
ALTER TABLE arena_m3_matrices RENAME TO arena_m3_matrices;
ALTER TABLE arena_model_params RENAME TO arena_model_params;

-- 2. Drop obsolete diagnostic tables (previously retained for rollback)
DROP TABLE IF EXISTS precision_matrices;
DROP TABLE IF EXISTS precision_recall_cells;
DROP TABLE IF EXISTS precision_optimizer_profiles;

-- 3. Migrate learning_items.algorithm_type values
UPDATE learning_items SET algorithm_type = 'adaptive' WHERE algorithm_type = 'adaptive';
UPDATE learning_items SET algorithm_type = 'precision' WHERE algorithm_type = 'precision';
UPDATE learning_items SET algorithm_type = 'classic' WHERE algorithm_type = 'm1';
UPDATE learning_items SET algorithm_type = 'classic_5' WHERE algorithm_type = 'm2';
UPDATE learning_items SET algorithm_type = 'classic_8' WHERE algorithm_type = 'm3';
UPDATE learning_items SET algorithm_type = 'classic_15' WHERE algorithm_type = 'm4';
```

### 4.2 Frontend Settings Store Hydration Migration (`src/stores/settingsStore.ts`)

In `settingsStore.ts`, add legacy key mapping in the hydration/normalization path:
```typescript
function normalizeLearningSettings(raw: any): LearningSettings {
  const algorithmMap: Record<string, LearningSettings["algorithm"]> = {
    adaptive: "adaptive",
    precision: "precision",
    classic: "classic",
    classic_5: "classic_5",
    classic_8: "classic_8",
    classic_15: "classic_15",
  };

  const algorithm = algorithmMap[raw.algorithm] ?? raw.algorithm ?? "fsrs";
  const precisionPureKernel = raw.precisionPureKernel ?? raw.precisionPureKernel ?? false;
  const arenaReviewMode = raw.arenaReviewMode ?? raw.arenaReviewMode ?? "automatic";

  return {
    ...raw,
    algorithm,
    precisionPureKernel,
    arenaReviewMode,
  };
}
```

---

## 5. Import Subsystem Decommissioning

The legacy legacy third-party collection XML/ZIP import path is dedicated solely to importing collections from a third-party application. It will be decommissioned completely:

1. **Delete Backend Files**:
   - Delete `src-tauri/src/legacy_third_party_import.rs`.
   - In `src-tauri/src/lib.rs`, remove `mod legacy_third_party_import;` and unregister `legacy_third_party_import::import_legacy_third_party_package` and `legacy_third_party_import::validate_legacy_third_party_package`.
2. **Delete Frontend Files**:
   - Delete `src/utils/legacyThirdPartyImport.ts`.
3. **Clean Up UI & File Pickers**:
   - In `src/components/documents/EnhancedFilePicker.tsx`, remove `"legacy-third-party"` from `ImportSource`, remove the file picker entry and filter, and remove associated icon/label.
   - In `src/routes/documents.tsx`, remove the `source === 'legacy-third-party'` handling branch.
4. **Delete Dedicated Documentation**:
   - Delete `docs/product/features/imports/legacy-third-party-zip.md`.
   - Remove `import.legacy-third-party_zip` from `scripts/docs-coverage.mjs`.

---

## 6. Documentation Architecture & RAG Knowledge Base

### 6.1 Documentation Replacements in `docs/product/`

| Action | Path | New Path / Title | Description |
| :--- | :--- | :--- | :--- |
| **DELETE** | `docs/product/features/imports/legacy-third-party-zip.md` | *(Deleted)* | Dedicated third-party import document removed. |
| **REPLACE** | `docs/product/features/scheduling/adaptive-algorithm.md` | `docs/product/features/scheduling/adaptive-scheduler.md` | **Plethora Adaptive Scheduler**: Explains 3D stability increase interpolation matrix across Difficulty, Stability, and Retrievability without third-party attribution. |
| **REPLACE** | `docs/product/features/scheduling/precision-arena.md` | `docs/product/features/scheduling/precision-arena.md` | **Algorithm Arena**: Explains parallel multi-model shadow evaluation and real-time accuracy scoring. |
| **REPLACE** | `docs/product/features/scheduling/precision-postpone.md` | `docs/product/features/scheduling/precision-postpone.md` | **Precision Postpone Engine**: Explains priority-weighted backlog redistribution and retention protection. |
| **UPDATE** | `docs/product/concepts/incremental-reading.md` | *(Updated in-place)* | Remove third-party pioneer attributions; describe Plethora's incremental reading pipeline directly. |
| **UPDATE** | `docs/product/features/queue/extract-chains.md` | *(Updated in-place)* | Retitle to **Hierarchical Extract Chains**; remove branded prefixes from title and aliases. |
| **UPDATE** | `docs/product/features/media/rss-queue.md` | *(Updated in-place)* | Neutralize queue processing philosophy description. |
| **UPDATE** | `docs/product/features/queue/priority-system.md` | *(Updated in-place)* | Retain mathematical 0-100 priority explanation; remove personal names and branded references. |

### 6.2 Help Index & Manifest Regeneration

- Run `node scripts/build-help-index.mjs` to regenerate:
  - `src/features/help/generated/helpIndex.json`
  - `src/features/help/generated/helpIndexData.ts`
- Ensure "Ask Plethora" answers product queries solely with verified Plethora documentation.
- Update `scripts/docs-coverage.mjs` feature table with new canonical IDs (`scheduler.adaptive`, `scheduler.precision.arena`, `scheduler.precision.postpone`, `queue.extract_chain`).

---

## 7. Rust Commands & API Layer Coordinated Refactor

| Old Tauri Command Name | New Tauri Command Name | TypeScript Wrapper Location |
| :--- | :--- | :--- |
| `get_precision_arena_stats` | `get_arena_stats` | `src/api/review.ts` (`getArenaStats`) |
| `optimize_precision_fsrs` | `optimize_arena_fsrs` | `src/api/review.ts` (`optimizeArenaFsrs`) |
| `optimize_precision_m4` | `optimize_precision_kernel` | `src/api/review.ts` (`optimizePrecisionKernel`) |
| `get_precision_optimization_status` | `get_arena_optimization_status` | `src/api/algorithm.ts` (`getArenaOptimizationStatus`) |
| `optimize_precision_locally` | `optimize_arena_locally` | `src/api/algorithm.ts` (`optimizeArenaLocally`) |
| `calculate_classic_next` | `calculate_classic_next` | `src/api/algorithm.ts` (`calculateClassicNext`) |
| `import_legacy_third_party_package` | *(Removed)* | *(Deleted)* |
| `validate_legacy_third_party_package` | *(Removed)* | *(Deleted)* |

---

## 8. Test Suite, Fixtures & Performance Benchmark Gate

### 8.1 Test Renaming & Assertions
- `src/lib/__tests__/adaptiveScheduler.test.ts` $\to$ `adaptiveScheduler.test.ts`
- `src/lib/__tests__/precisionScheduler.test.ts` $\to$ `precisionScheduler.test.ts`
- `src/lib/__tests__/rating-grades.test.ts` $\to$ `ratingGrades.test.ts`
- `src/components/review/__tests__/SixGradeRatingControl.matrix.test.tsx` $\to$ `SixGradeRatingControl.matrix.test.tsx`
- `src/shared/arenaParityFixture.json` $\to$ `src/shared/arenaParityFixture.json`

### 8.2 Benchmark Gate (`scripts/perf-baselines.json` & `AGENTS.md` compliance)
- Rename `src/lib/precision.bench.ts` $\to$ `src/lib/precision.bench.ts`.
- Rename benchmark identifier: `"precision/review-sequence"` $\to$ `"precision-scheduler/review-sequence"`.
- Update `scripts/perf-baselines.json` with the new benchmark name, maintaining the identical cost ratio and tolerance.
- Update reason strings in `perf-baselines.json` to eliminate references like "Plethora combined-criterion session sort" in favor of "Plethora combined-criterion session sort".

---

## 9. OpenSpec Change History Sanitization

To ensure that the checked-out repository tree contains zero occurrences of legacy branding in search tools:
1. Rename / sanitize completed change folders in `openspec/changes/`:
   - `fix-legacy-third-party-zip-import/` $\to$ archive or neutralize text.
   - `unified-priority-queue/` $\to$ `unified-priority-queue/` (or update internal text).
   - `unified-rating-ux/` $\to$ `unified-rating-ux/`.
   - `add-adaptive-algorithm-selector/` $\to `add-adaptive-algorithm-selector/`.
   - `add-adaptive-algorithm-transparency/` $\to `add-adaptive-algorithm-transparency/`.
   - `fix-precision-activation/` $\to `fix-precision-activation/`.
   - `fix-precision-algorithm/` $\to `fix-precision-algorithm/`.
   - `update-precision-algorithm/` $\to `update-precision-algorithm/`.
2. Update active spec requirements in `openspec/specs/postpone-engine/spec.md`, `specs/scheduler-catalog/spec.md`, etc., removing all branded references from Gherkin scenarios.

---

## 10. Validation & Search Gate Protocol

Implementation completion requires passing two rigorous gates:

### Gate 1: Zero-Occurrence Audit
Execute case-insensitive repository search across all tracked files and filenames:
```bash
# 1. Content scan (must return 0 results)
git grep -ni "legacy-third-party"
git grep -ni "legacy third-party product name"
git grep -niE '\bsm[-_ ]?18\b'
git grep -niE '\bsm[-_ ]?20\b'
git grep -niE '\bsm[-_ ]?15\b'
git grep -niE '\bsm[-_ ]?19\b'
git grep -ni "legacy stability matrix data"
git grep -ni "super-memory\.com"
git grep -ni "legacy-third-party\.guru"

# 2. Path/filename scan (must return 0 results)
git ls-files | grep -i 'legacy-third-party'
git ls-files | grep -Ei 'sm[-_ ]?18|sm[-_ ]?20'
```

### Gate 2: Full Test & Build Verification
```bash
npm run typecheck
npm run test
npm run bench:check
npm run test:scripts
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/docs-validate.mjs
node scripts/docs-coverage.mjs
```
