# Design: Establish Persistent Learner Model

## 1. Architecture Overview

The Persistent Learner Model extends `learning_evidence_repository.rs` and `concept_repository.rs` (avoiding parallel subsystems) to project `learning_events` and `learning_evidence` into a canonical, inspectable 5-dimension competency profile per concept.

```text
learning_events (checkpoint: learner_model_v1) + learning_evidence (exams)
        │
        ▼  ingest_event_to_competency_evidence_tx (strict provenance & policy filter)
┌───────────────────────────┐    ┌────────────────────────────────┐
│   competency_evidence     │    │ learner_competency_declarations │
│ (dimension, group, family,│    │ (self_declared, separate from   │
│  score, weight, privacy)  │    │  demonstrated evidence)         │
└───────────────────────────┘    └────────────────────────────────┘
        │                                       │
        ▼  recompute_concept_competency_tx (5D estimator + correlated-card damping)
┌─────────────────────────────────────────────────────────────────┐
│                    competency_projections                       │
│  (concept_id, dimension) -> status, estimate, confidence,       │
│  effective_weight, independent_groups, distinct_days, reasons   │
└─────────────────────────────────────────────────────────────────┘
        │
        ├──► Knowledge Atlas 5D overlay & Evidence Inspector
        ├──► Unified Learning Goals (mastery progress & prior-evidence skipping)
        ├──► Adaptive Curricula & Remediation (dimension-targeted routing)
        └──► DAQE & Personal Learning Coach (privacy-filtered reads)
```

### Core Epistemic Rules

1. **Five Independent Dimensions:**
   - `exposure`: Document reading progress, guided reading segments, audio/video listening, extract creation. Page views produce `exposure` ONLY and NEVER raise `comprehension`, `retention`, `application`, or `transfer`.
   - `comprehension`: Guided reading formative checks, Socratic concept explanations, conceptual exam questions, definition/contrast items.
   - `retention`: Delayed FSRS-7 recall outcomes (`review_committed` with `elapsed_days >= 1.0` receiving full retention weight; same-day reviews heavily discounted as short-term cramming) and delayed retention checks.
   - `application`: Worked problems, procedural/calculation exam items, language production/writing/dictation practice, applied rubric items.
   - `transfer`: Novel-context exam items, cross-concept synthesis tasks, unprompted multi-concept application, capstone rubrics.
2. **No Unverified AI Inflation:** Freeform AI assistant chats and `model-only` blueprint checks are tagged `is_verified = 0` (or rejected at ingestion) and NEVER contribute to demonstrated `comprehension`, `retention`, `application`, or `transfer`.
3. **Explicit `unknown` / `insufficient_evidence`:** A dimension with 0 active evidence rows MUST have `status = 'unknown'` and `estimate = null`. A dimension with evidence below minimum independent-group or effective-weight thresholds MUST have `status = 'insufficient_evidence'` and explicit `uncertainty_reasons` (e.g., `["single_session_only", "correlated_cards_only", "insufficient_weight"]`).
4. **Separation of Self-Declared vs Demonstrated:** Learner declarations (`"I already know this"` / `"I need help with this"`) are stored in `learner_competency_declarations` and surfaced alongside—never merged into—demonstrated `competency_projections`.

---

## 2. SQLite Schema (`169_persistent_learner_model`)

Added sequentially in `src-tauri/src/database/migrations.rs` immediately after `168_unify_learning_state_events`:

```sql
-- Migration 169_persistent_learner_model
CREATE TABLE IF NOT EXISTS competency_evidence (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL CHECK (dimension IN (
        'exposure', 'comprehension', 'retention', 'application', 'transfer'
    )),
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'reading_progress', 'extract_created', 'guided_check',
        'fsrs_review', 'socratic_practice', 'practice_attempt',
        'exam_grade', 'diagnostic_grade', 'language_practice'
    )),
    source_event_id TEXT REFERENCES learning_events(id) ON DELETE SET NULL,
    source_record_id TEXT NOT NULL,
    evidence_group_id TEXT NOT NULL,
    card_family_id TEXT,
    session_id TEXT,
    observed_score REAL CHECK (observed_score IS NULL OR (observed_score >= 0.0 AND observed_score <= 1.0)),
    base_weight REAL NOT NULL CHECK (base_weight > 0.0 AND base_weight <= 2.0),
    elapsed_days REAL,
    hint_level INTEGER NOT NULL DEFAULT 0 CHECK (hint_level >= 0),
    is_verified INTEGER NOT NULL DEFAULT 1 CHECK (is_verified IN (0, 1)),
    is_invalidated INTEGER NOT NULL DEFAULT 0 CHECK (is_invalidated IN (0, 1)),
    invalidated_by_event_id TEXT REFERENCES learning_events(id) ON DELETE SET NULL,
    document_id TEXT,
    is_local_only INTEGER NOT NULL DEFAULT 0 CHECK (is_local_only IN (0, 1)),
    is_ai_excluded INTEGER NOT NULL DEFAULT 0 CHECK (is_ai_excluded IN (0, 1)),
    occurred_at TEXT NOT NULL,
    policy_version TEXT NOT NULL DEFAULT 'competency-v1',
    created_at TEXT NOT NULL,
    UNIQUE(concept_id, dimension, source_kind, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_competency_evidence_concept_dim
    ON competency_evidence(concept_id, dimension, is_invalidated, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_competency_evidence_source_event
    ON competency_evidence(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competency_evidence_group
    ON competency_evidence(concept_id, dimension, evidence_group_id);

CREATE TABLE IF NOT EXISTS competency_projections (
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL CHECK (dimension IN (
        'exposure', 'comprehension', 'retention', 'application', 'transfer'
    )),
    status TEXT NOT NULL CHECK (status IN (
        'unknown', 'insufficient_evidence', 'needs_attention', 'developing', 'demonstrated'
    )),
    estimate REAL CHECK (estimate IS NULL OR (estimate >= 0.0 AND estimate <= 1.0)),
    confidence REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    effective_weight REAL NOT NULL DEFAULT 0.0,
    raw_evidence_count INTEGER NOT NULL DEFAULT 0,
    independent_groups INTEGER NOT NULL DEFAULT 0,
    distinct_days INTEGER NOT NULL DEFAULT 0,
    uncertainty_reasons_json TEXT NOT NULL DEFAULT '[]',
    evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    contains_local_only_evidence INTEGER NOT NULL DEFAULT 0 CHECK (contains_local_only_evidence IN (0, 1)),
    contains_ai_excluded_evidence INTEGER NOT NULL DEFAULT 0 CHECK (contains_ai_excluded_evidence IN (0, 1)),
    last_evidence_at TEXT,
    policy_version TEXT NOT NULL DEFAULT 'competency-v1',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (concept_id, dimension)
);

CREATE TABLE IF NOT EXISTS learner_competency_declarations (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    declared_level TEXT NOT NULL CHECK (declared_level IN (
        'unfamiliar', 'familiar', 'confident', 'needs_refresh'
    )),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(concept_id)
);
```

---

## 3. 5-Dimension Competency Estimation Algorithm

Both Rust (`learning_evidence_repository.rs`) and TypeScript (`src/lib/learner-model/competencyEstimator.ts`) implement the exact same deterministic pure function `estimateDimensionCompetency(records, nowIso)`:

### Step 1: Filtering
Exclude any row where `is_invalidated == true` or `is_verified == false` or `observed_score == null` (for `exposure`, presence of a verified reading/extract event carries `observed_score` in `[0.25, 1.0]` based on coverage ratio).
For cloud AI queries, additionally filter out `is_ai_excluded == true` before estimation.

### Step 2: Per-Observation Adjustments
For each active observation $i$:
1. **Hint discounting:**
   $$h_i = \max(0.25,\; 1.0 - 0.25 \cdot \text{hint\_level}_i)$$
2. **Short-term cramming discount (for `retention` only):**
   If `source_kind == 'fsrs_review'` and `elapsed_days < 1.0`, apply $d_{\text{delay},i} = 0.20 + 0.80 \cdot \max(0, \text{elapsed\_days}_i)$. Delayed reviews ($\ge 1$ day) receive $d_{\text{delay},i} = 1.0$.
3. **Recency decay:**
   Let $\Delta t_i$ be age in days relative to `nowIso`, and half-life $H_d$ be dimension-specific (`exposure: 90d`, `comprehension: 120d`, `retention: 45d`, `application: 120d`, `transfer: 180d`):
   $$r_i = \max\left(0.15,\; 2^{-\Delta t_i / H_d}\right)$$
4. **Raw observation weight:**
   $$w_i^{\text{raw}} = \text{base\_weight}_i \cdot h_i \cdot d_{\text{delay},i} \cdot r_i$$

### Step 3: Correlated-Card / Same-Group Damping
Group active observations by correlation key `group_key = card_family_id ?? evidence_group_id`. Within each group, sort observations by `occurred_at DESC` (index $k = 0, 1, 2, \dots$). Apply harmonic/sublinear damping within the group:
$$w_{g,k}^{\text{eff}} = \frac{w_{g,k}^{\text{raw}}}{(k + 1)^{0.85}}$$
Cap the total effective weight contributed by any single correlation group at $W_{\text{group\_max}} = 1.5 \cdot \max_k(w_{g,k}^{\text{raw}})$.
This guarantees that drilling 20 correlated cloze cards from one paragraph cannot exceed 1.5x the weight of a single independent check, and `independent_groups` counts distinct `group_key` values.

### Step 4: Posterior Estimate, Confidence, and Status Classification
- If `active_records.is_empty()`:
  - `status = "unknown"`, `estimate = None`, `confidence = 0.0`, `uncertainty_reasons = ["no_evidence"]`.
- Otherwise:
  - Weighted mean:
    $$\hat{\mu} = \frac{\sum w_i^{\text{eff}} \cdot s_i}{\sum w_i^{\text{eff}}}$$
  - Effective weight $W_{\text{eff}} = \sum w_i^{\text{eff}}$, `independent_groups` $G$, `distinct_days` $D$.
  - Confidence:
    $$c = \left(1 - e^{-W_{\text{eff}} / 2.0}\right) \cdot \min\left(1.0,\; \frac{G}{2.0}\right) \cdot \min\left(1.0,\; \frac{D}{2.0}\right)$$
    (For `exposure`, single-session/single-group reading is sufficient to leave `insufficient_evidence` once $W_{\text{eff}} \ge 0.5$.)
  - Uncertainty reasons collected deterministically:
    - `W_eff < 1.0` (non-exposure) $\rightarrow$ `"low_effective_weight"`
    - `G < 2` (non-exposure) $\rightarrow$ `"single_evidence_group"`
    - `D < 2` (for `retention` / `comprehension`) $\rightarrow$ `"single_day_only"`
    - All evidence older than $H_d$ $\rightarrow$ `"stale_evidence"`
  - Status classification:
    - If non-exposure and (`W_eff < 0.75` or (`G == 1` and `raw_evidence_count >= 2` and `W_eff < 1.2`)): `status = "insufficient_evidence"` (preserving `estimate` as indicative only, with low `confidence`).
    - Else if $\hat{\mu} < 0.50$: `status = "needs_attention"`.
    - Else if $\hat{\mu} < 0.80$ or `confidence < 0.60`: `status = "developing"`.
    - Else: `status = "demonstrated"`.

---

## 4. Rust & TypeScript Interfaces

### Rust (`src-tauri/src/models/learning_evidence.rs` extension)

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CompetencyDimension {
    Exposure,
    Comprehension,
    Retention,
    Application,
    Transfer,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompetencyStatus {
    Unknown,
    InsufficientEvidence,
    NeedsAttention,
    Developing,
    Demonstrated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionProjection {
    pub dimension: CompetencyDimension,
    pub status: CompetencyStatus,
    pub estimate: Option<f64>,
    pub confidence: f64,
    pub effective_weight: f64,
    pub raw_evidence_count: i64,
    pub independent_groups: i64,
    pub distinct_days: i64,
    pub uncertainty_reasons: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub last_evidence_at: Option<String>,
    pub policy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptCompetencyProfile {
    pub concept_id: String,
    pub concept_name: String,
    pub dimensions: std::collections::HashMap<CompetencyDimension, DimensionProjection>,
    pub self_declaration: Option<LearnerCompetencyDeclaration>,
    pub contains_local_only_evidence: bool,
    pub contains_ai_excluded_evidence: bool,
}
```

### TypeScript (`src/lib/learner-model/types.ts`)

```ts
export type CompetencyDimension =
  | "exposure"
  | "comprehension"
  | "retention"
  | "application"
  | "transfer";

export type CompetencyStatus =
  | "unknown"
  | "insufficient_evidence"
  | "needs_attention"
  | "developing"
  | "demonstrated";

export interface DimensionProjection {
  dimension: CompetencyDimension;
  status: CompetencyStatus;
  estimate: number | null;
  confidence: number;
  effectiveWeight: number;
  rawEvidenceCount: number;
  independentGroups: number;
  distinctDays: number;
  uncertaintyReasons: string[];
  evidenceIds: string[];
  lastEvidenceAt: string | null;
  policyVersion: string;
}

export interface ConceptCompetencyProfile {
  conceptId: string;
  conceptName: string;
  dimensions: Record<CompetencyDimension, DimensionProjection>;
  selfDeclaration: {
    declaredLevel: "unfamiliar" | "familiar" | "confident" | "needs_refresh";
    note: string | null;
    updatedAt: string;
  } | null;
  containsLocalOnlyEvidence: boolean;
  containsAiExcludedEvidence: boolean;
}
```

---

## 5. Evidence Invalidation & Recomputation

When `learning_events` receives `review_undone` or `assessment_grade_invalidated` referencing `retracted_event_id` (or `grade_id`):
1. Mark matching `competency_evidence` rows `is_invalidated = 1`, `invalidated_by_event_id = <event.id>`.
2. Recompute `competency_projections` for every `(concept_id, dimension)` touched by the invalidated rows inside the same transaction.
3. Synchronize `learning_concept_summaries` for backward compatibility.

---

## 6. Testing Strategy

1. **Migration Test (`169_persistent_learner_model`):** Verify table creation, `CHECK` constraints, `UNIQUE` constraints, cascade delete from `concepts`, and zero FK violations.
2. **Rust + TS Parity Tests (`src/lib/learner-model/__tests__/competencyEstimator.parity.test.ts` + Rust unit tests):** Shared golden fixtures covering:
   - Zero evidence $\rightarrow$ `unknown`, `estimate = null`.
   - Page views only $\rightarrow$ `exposure` updates; `comprehension`/`retention`/`application`/`transfer` remain `unknown`.
   - 10 correlated cloze cards in one `card_family_id` on one day $\rightarrow$ damped weight, `independent_groups = 1`, `status = insufficient_evidence` or low confidence, never `demonstrated`.
   - Delayed FSRS-7 reviews across multiple days and independent cards $\rightarrow$ `retention` reaches `demonstrated`.
   - Hint discounting and recency decay.
   - Evidence invalidation on `review_undone` and `assessment_grade_invalidated` restores prior projection accurately.
   - Unverified / `model-only` events rejected from demonstrated projections.
3. **Privacy Filtering Test:** Verify `get_concept_competency_profile(..., ai_context = true)` excludes `is_ai_excluded = 1` evidence from the returned projection.
4. **Knowledge Atlas UI Test:** Verify 5D competency badges render `Unknown` / `Insufficient Evidence` explicitly and the Evidence Inspector lists provenance records.
