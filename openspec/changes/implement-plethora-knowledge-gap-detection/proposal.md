# Change: Implement Plethora Knowledge Gap Detection

> Wave 2 — Intelligence (after 7 + 9, benefiting from 8/13 signals). Capability: `knowledge_gap_detection`. Local analysis available; cloud model analysis capability-gated.

## Why

Users accumulate materials that imply prerequisite structures the app can infer: "You understand paging and virtual memory, but your materials indicate weak understanding of TLB behavior." Combining reading history, semantic structure, review performance, flashcards, and graph relations, Plethora can identify **probable** weak or missing knowledge — with mandatory honesty about uncertainty and full explainability — and offer concrete next actions.

## What exists today
- **Signals already collected**: `review_results` (ratings, lapses, time), per-item FSRS state (stability/difficulty/reps) on documents/extracts/learning_items, `study_statistics` rollups, `item_stats_repository`, `sm20_arena` adaptive-weight history, recall prompts (`recall_prompt_history` with outcomes), `answer_assessments` (AI grading of free answers), `passage_scores`, reading-session heartbeats (`item_activity_log`).
- **Structural signals** (from 7/8/9): semantic chunks, accepted connections, concept graph with `prerequisite-of` relations and confidence, extraction coverage per document.
- **Partial precedent**: `prerequisite-analysis` task exists (`src/lib/ai/tasks/definitions/prerequisiteTask.ts`) — used for tutoring context, not library-wide gap detection. `LearnThisProposalSheet` shows the proposal-UX pattern.

## What Changes

### 1. Gap signal aggregation (`src-tauri/src/knowledge_health/gaps.rs` — module shared namespace with 15)
- **Gap kinds** with per-kind detection rules:
  - `weak_prerequisite`: graph `prerequisite-of` edges whose target concept shows weak mastery while dependent concepts are being actively studied.
  - `missing_concept`: concepts referenced by edges/queue materials with no covering source or card in the library.
  - `repeatedly_failed`: items/concepts whose review history exceeds lapse thresholds (configurable; e.g. ≥4 lapses or stability-decline trend).
  - `read_never_reviewed`: documents/chunks read (activity + passage scores) with zero extract/card/review conversion after N days.
  - `disconnected_cluster`: graph regions with high internal density but near-zero edges to the user's core graph (possible missing bridging concepts).
  - `weak_transfer`: concepts with strong definitional recall but failing application/question cards (answer_assessments + card-type split).
- **Mastery estimate per concept** (0–1 with variance): Bayesian blend of review retrievability (FSRS), assessment outcomes, coverage (sources read), recency — explicitly labeled an estimate; variance surfaced.
- Detection runs as bounded background analysis (battery/idle gates like the indexer), incremental over changed signals, results cached with staleness timestamps.

### 2. Explainability (mandatory)
Every gap carries `evidence[]`: the exact contributing records (review results, unreviewed-read chunks, graph edges with citations, assessment history) and the rule that fired. "Why do you think this?" always answers with data the user can inspect and dispute. Users can mark a gap `not-applicable` (suppression with reason, re-evaluable).

### 3. Actions
Each gap offers: **Explain** (evidence view), **Teach me** (routes to proposal 12 with gap context), **Find material** (library search + optional web/arXiv search via existing Brave/arXiv integrations), **Generate practice** (routes to 13 for application cards), **Make cards** (13), **Dismiss** (suppression).

### 4. UX
- **Gaps surface**: a calm section within Analytics/Knowledge Health (15 owns the dashboard shell; this owns the gaps module) + contextual entry: when a review session repeatedly fails items in a concept cluster, a single post-session summary line ("3 items suggest a TLB gap — inspect?") — never mid-session interruptions.
- E-ink-friendly text-first rendering.

### 5. Local vs cloud
- Rule-based detection + mastery estimation: local, Free.
- Model-assisted detection (LLM reasoning over aggregated evidence summaries — compact, not raw library): `knowledge_gap_detection` capability, job-based, evidence summaries only leave the device (privacy disclosure); AI-exclusion honored.

## Impact

### Affected Specs
- `knowledge-gap-detection` — New (gap kinds, mastery estimation, explainability, actions, suppression, uncertainty framing).

### Affected Code Areas
- New `src-tauri/src/knowledge_health/` (gaps module; analytics module lands with 15 — shared namespace agreed, disjoint files), gap store/UI components, routes to 12/13 actions, i18n.

### Non-goals
- No learning-path generation (11), no tutoring implementation (12), no card generation (13), no grading of users externally, no certainty claims.

## Dependencies

### Hard dependencies
- Proposal 7 (semantic coverage), 9 (graph relations for prerequisite/cluster gaps).

### Soft dependencies
- 8 (connections feed concepts), 13 (action target), 12 (action target), 15 (dashboard shell — this module can render standalone until then).

### May run concurrently
- 11 late-stage (consumes gaps), 12/13/14/15.

### Must not start yet
- — (this is the gate for 11's full value; 11 may scaffold earlier against the contract).

## Shared interfaces
- `knowledge_gap` type + `list_gaps`, `gap_evidence`, `suppress_gap` commands; `gaps-updated` event; mastery-estimate query API (shared with 15 by agreement: this change owns `knowledge_health/gaps.rs`, 15 owns `knowledge_health/metrics.rs`).

## Ownership boundaries
- **May modify**: new knowledge_health gap files, analytics-page section mount, action-routing helpers.
- **Must treat as external**: graph schema (9), retrieval (7), tutor/card-gen entry APIs (12/13), review/scheduling internals (read-only queries).

## Collision risks
- `knowledge_health/` namespace (with 15 — file-level split agreed); AnalyticsPage mount points (15 owns shell; coordinate additive sections); settings subtree `knowledgeHealth`.

## Integration contract
- Gap records consumed by 11 (path planning inputs) and 12 (tutor entry with context); mastery estimates consumed by 15 dashboards; evidence format = citation-backed records.

## Testing & acceptance

### Tests
- Detection-rule unit tests per gap kind against seeded fixtures (synthetic review histories with known gaps; seeded PRNG).
- Mastery estimation: monotonicity (more successes → higher estimate), variance behavior, recency decay.
- Explainability: every surfaced gap's evidence resolves to real records; suppression honored; re-evaluation after new evidence.
- Uncertainty framing: UI copy tests ensure probabilistic language (snapshot per locale sample).
- Performance: incremental detection within idle-budget p95 at fixture scale (bench + baseline per protocol).

### Acceptance criteria
- Seeded "weak TLB" fixture produces a `weak_prerequisite` gap with inspectable evidence and working Explain/Teach-me/Find/Cards/Dismiss actions; no gap appears without evidence; user suppression sticks; local-only mode fully functional.

### Must remain unchanged
- Review session flow (no mid-session interruptions); scheduling behavior; existing analytics correctness.

## Open questions
1. Threshold defaults (lapse counts, N-days unreviewed) — ship conservative, expose in settings.
2. Whether gaps ever surface outside analytics/post-session contexts (default no).
