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
├── adaptive.rs                   # Renamed from sm18.rs (3D SInc Matrix Scheduler)
├── adaptive_data.rs              # Renamed from sm18_data.rs (Static matrix constant tables)
├── precision/                    # Renamed directory from sm20/
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
├── classic.rs                    # Renamed from supermemo.rs (Classic factor algorithms 2/5/8/15)
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
            "adaptive" | "sm18" => AlgorithmType::Adaptive,
            "precision" | "sm20" => AlgorithmType::Precision,
            "classic" | "sm2" => AlgorithmType::Classic,
            "classic_5" | "sm5" => AlgorithmType::Classic5,
            "classic_8" | "sm8" => AlgorithmType::Classic8,
            "classic_15" | "sm15" => AlgorithmType::Classic15,
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
├── rating-grades.ts              # Renamed from supermemo-grades.ts (0-5 & 1-4 grade scales)
├── adaptiveScheduler.ts          # Renamed from sm18.ts (TS mirror of 3D SInc engine)
├── precisionScheduler.ts         # Renamed from sm20.ts (TS mirror of precision kernel & arena)
├── precisionCollection.ts        # Renamed from sm20Collection.ts (Collection-wide matrix state)
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

Rename `src/lib/supermemo-grades.ts` $\to$ `src/lib/rating-grades.ts`:
- Replace `SuperMemoGrade` $\to$ `SixGradeDefinition`.
- Replace `SUPERMEMO_GRADES` $\to$ `SIX_GRADE_SCALE`.
- Replace `SM20NativeGrade` $\to$ `SixPointGrade` (`0 | 1 | 2 | 3 | 4 | 5`).
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
    return algorithm === "adaptive" || algorithm === "precision" || algorithm === "sm18" || algorithm === "sm20"
      ? SIX_GRADE_RATING_SCHEMA
      : FOUR_GRADE_RATING_SCHEMA;
  }
  ```

### 3.2 Rating Component (`src/components/review/SixGradeRatingControl.tsx`)

Rename `SuperMemoRatingControl.tsx` $\to$ `SixGradeRatingControl.tsx`:
- Export `SixGradeRatingControl` and `useIsTouchRating`.
- Internal helper `TouchSuperMemoRating` $\to$ `TouchSixGradeRating`.
- Consumed by `ReviewSession.tsx`, `ZenReviewMode.tsx`, `FlashcardScrollItem.tsx`, and `QueueScrollPage.tsx`.

---

## 4. Database Schema, Persistence & Settings Migration

### 4.1 SQLite Schema & Data Migration (`086_complete_plethora_identity_migration`)

Add migration 086 to `src-tauri/src/database/migrations.rs`:
```sql
-- 1. Migrate table names
ALTER TABLE sm20_arena RENAME TO arena_state;
ALTER TABLE sm20_m2_optimizer RENAME TO arena_m2_optimizer;
ALTER TABLE sm20_m3_matrices RENAME TO arena_m3_matrices;
ALTER TABLE sm20_model_params RENAME TO arena_model_params;

-- 2. Drop obsolete diagnostic tables (previously retained for rollback)
DROP TABLE IF EXISTS sm20_matrices;
DROP TABLE IF EXISTS sm20_recall_cells;
DROP TABLE IF EXISTS sm20_optimizer_profiles;

-- 3. Migrate learning_items.algorithm_type values
UPDATE learning_items SET algorithm_type = 'adaptive' WHERE algorithm_type = 'sm18';
UPDATE learning_items SET algorithm_type = 'precision' WHERE algorithm_type = 'sm20';
UPDATE learning_items SET algorithm_type = 'classic' WHERE algorithm_type = 'sm2';
UPDATE learning_items SET algorithm_type = 'classic_5' WHERE algorithm_type = 'sm5';
UPDATE learning_items SET algorithm_type = 'classic_8' WHERE algorithm_type = 'sm8';
UPDATE learning_items SET algorithm_type = 'classic_15' WHERE algorithm_type = 'sm15';
```

### 4.2 Frontend Settings Store Hydration Migration (`src/stores/settingsStore.ts`)

In `settingsStore.ts`, add legacy key mapping in the hydration/normalization path:
```typescript
function normalizeLearningSettings(raw: any): LearningSettings {
  const algorithmMap: Record<string, LearningSettings["algorithm"]> = {
    sm18: "adaptive",
    sm20: "precision",
    sm2: "classic",
    sm5: "classic_5",
    sm8: "classic_8",
    sm15: "classic_15",
  };

  const algorithm = algorithmMap[raw.algorithm] ?? raw.algorithm ?? "fsrs";
  const precisionPureKernel = raw.precisionPureKernel ?? raw.sm20PureM4 ?? false;
  const arenaReviewMode = raw.arenaReviewMode ?? raw.sm20ArenaReviewMode ?? "automatic";

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

The legacy SuperMemo XML/ZIP import path is dedicated solely to importing collections from a third-party application. It will be decommissioned completely:

1. **Delete Backend Files**:
   - Delete `src-tauri/src/supermemo_import.rs`.
   - In `src-tauri/src/lib.rs`, remove `mod supermemo_import;` and unregister `supermemo_import::import_supermemo_package` and `supermemo_import::validate_supermemo_package`.
2. **Delete Frontend Files**:
   - Delete `src/utils/supermemoImport.ts`.
3. **Clean Up UI & File Pickers**:
   - In `src/components/documents/EnhancedFilePicker.tsx`, remove `"supermemo"` from `ImportSource`, remove the file picker entry and filter, and remove associated icon/label.
   - In `src/routes/documents.tsx`, remove the `source === 'supermemo'` handling branch.
4. **Delete Dedicated Documentation**:
   - Delete `docs/product/features/imports/supermemo-zip.md`.
   - Remove `import.supermemo_zip` from `scripts/docs-coverage.mjs`.

---

## 6. Documentation Architecture & RAG Knowledge Base

### 6.1 Documentation Replacements in `docs/product/`

| Action | Path | New Path / Title | Description |
| :--- | :--- | :--- | :--- |
| **DELETE** | `docs/product/features/imports/supermemo-zip.md` | *(Deleted)* | Dedicated third-party import document removed. |
| **REPLACE** | `docs/product/features/scheduling/sm18-algorithm.md` | `docs/product/features/scheduling/adaptive-scheduler.md` | **Plethora Adaptive Scheduler**: Explains 3D stability increase interpolation matrix across Difficulty, Stability, and Retrievability without third-party attribution. |
| **REPLACE** | `docs/product/features/scheduling/sm20-arena.md` | `docs/product/features/scheduling/precision-arena.md` | **Algorithm Arena**: Explains parallel multi-model shadow evaluation and real-time accuracy scoring. |
| **REPLACE** | `docs/product/features/scheduling/sm20-postpone.md` | `docs/product/features/scheduling/precision-postpone.md` | **Precision Postpone Engine**: Explains priority-weighted backlog redistribution and retention protection. |
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
| `get_sm20_arena_stats` | `get_arena_stats` | `src/api/review.ts` (`getArenaStats`) |
| `optimize_sm20_fsrs` | `optimize_arena_fsrs` | `src/api/review.ts` (`optimizeArenaFsrs`) |
| `optimize_sm20_m4` | `optimize_precision_kernel` | `src/api/review.ts` (`optimizePrecisionKernel`) |
| `get_sm20_optimization_status` | `get_arena_optimization_status` | `src/api/algorithm.ts` (`getArenaOptimizationStatus`) |
| `optimize_sm20_locally` | `optimize_arena_locally` | `src/api/algorithm.ts` (`optimizeArenaLocally`) |
| `calculate_sm2_next` | `calculate_classic_next` | `src/api/algorithm.ts` (`calculateClassicNext`) |
| `import_supermemo_package` | *(Removed)* | *(Deleted)* |
| `validate_supermemo_package` | *(Removed)* | *(Deleted)* |

---

## 8. Test Suite, Fixtures & Performance Benchmark Gate

### 8.1 Test Renaming & Assertions
- `src/lib/__tests__/sm18.test.ts` $\to$ `adaptiveScheduler.test.ts`
- `src/lib/__tests__/sm20.test.ts` $\to$ `precisionScheduler.test.ts`
- `src/lib/__tests__/supermemo-grades.test.ts` $\to$ `ratingGrades.test.ts`
- `src/components/review/__tests__/SuperMemoRatingControl.matrix.test.tsx` $\to$ `SixGradeRatingControl.matrix.test.tsx`
- `src/shared/sm20ArenaParityFixture.json` $\to$ `src/shared/arenaParityFixture.json`

### 8.2 Benchmark Gate (`scripts/perf-baselines.json` & `AGENTS.md` compliance)
- Rename `src/lib/sm20.bench.ts` $\to$ `src/lib/precision.bench.ts`.
- Rename benchmark identifier: `"sm20/review-sequence"` $\to$ `"precision-scheduler/review-sequence"`.
- Update `scripts/perf-baselines.json` with the new benchmark name, maintaining the identical cost ratio and tolerance.
- Update reason strings in `perf-baselines.json` to eliminate references like "SuperMemo combined-criterion session sort" in favor of "Plethora combined-criterion session sort".

---

## 9. OpenSpec Change History Sanitization

To ensure that the checked-out repository tree contains zero occurrences of legacy branding in search tools:
1. Rename / sanitize completed change folders in `openspec/changes/`:
   - `fix-supermemo-zip-import/` $\to$ archive or neutralize text.
   - `supermemo-faithful-queue/` $\to$ `unified-priority-queue/` (or update internal text).
   - `unify-supermemo-rating-ux/` $\to$ `unified-rating-ux/`.
   - `add-sm18-algorithm-selector/` $\to `add-adaptive-algorithm-selector/`.
   - `add-sm18-algorithm-transparency/` $\to `add-adaptive-algorithm-transparency/`.
   - `fix-sm20-activation/` $\to `fix-precision-activation/`.
   - `fix-sm20-algorithm/` $\to `fix-precision-algorithm/`.
   - `update-sm20-algorithm/` $\to `update-precision-algorithm/`.
2. Update active spec requirements in `openspec/specs/postpone-engine/spec.md`, `specs/scheduler-catalog/spec.md`, etc., removing all branded references from Gherkin scenarios.

---

## 10. Validation & Search Gate Protocol

Implementation completion requires passing two rigorous gates:

### Gate 1: Zero-Occurrence Audit
Execute case-insensitive repository search across all tracked files and filenames:
```bash
# 1. Content scan (must return 0 results)
git grep -ni "supermemo"
git grep -ni "super memo"
git grep -niE '\bsm[-_ ]?18\b'
git grep -niE '\bsm[-_ ]?20\b'
git grep -niE '\bsm[-_ ]?15\b'
git grep -niE '\bsm[-_ ]?19\b'
git grep -ni "StabilityIncrease"
git grep -ni "super-memory\.com"
git grep -ni "supermemo\.guru"

# 2. Path/filename scan (must return 0 results)
git ls-files | grep -i 'supermemo'
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
