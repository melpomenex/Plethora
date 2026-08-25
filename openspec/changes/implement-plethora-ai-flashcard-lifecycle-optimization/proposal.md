# Change: Implement Plethora AI Flashcard Lifecycle Optimization

> Wave 2 — Intelligence (after 13; consumes review/scheduling signals). Capability: `card_optimizer`.

## Why

Cards decay: poorly worded, duplicated, testing the same fact, outdated by newer sources, remembered in definition but failing application. AI should help *maintain* the deck — "This card has been failed four times and may be poorly worded", "These three cards test the same fact" — proposing rewrite/split/merge/retire/generate-application actions, **never silently rewriting user knowledge**: confirmation required unless explicitly configured otherwise.

## What exists today
- Rich review history: `review_results` (ratings, time, lapses, per-review), `review_log`, per-item FSRS state (stability/difficulty/reps/lapses), `precision_*` arena data, `item_stats_repository` summaries.
- Card model: `learning_items` (item_type, algorithm_state, priority trio, interaction_metadata), decks (`studyDeckStore`), FTS `extract_search`/`document_search`, embeddings index (7).
- Provenance: `ai_provenance` + `source_ref` on AI-created cards (13 guarantees).
- Concept graph (9) for concept-level aggregation; duplicate detection primitives (13) for merge candidates.
- No maintenance/proposal system exists.

## What Changes

### 1. Signal analysis (`src-tauri/src/card_maintenance/`)
- **Degradation detectors** (deterministic rules over review history):
  - `failing_streak`: N+ consecutive/aggregate fails with low stability trend → suspect wording/ambiguity.
  - `excessive_effort`: consistently long time-taken with correct answers → overly complex card.
  - `same_fact_group`: duplicate-detection clustering (13's similarity) + identical source_ref groups.
  - `definition_application_split`: cards on concept X passing definitional forms while application forms fail (uses card forms from 13 + concept links).
  - `stale_source`: card's source_ref document superseded (newer edition/version in library — via metadata + content-hash lineage heuristics) or source deleted.
  - `orphan_concept`: card's concept merged/removed in graph (9) leaving dangling linkage.
- **Analysis cadence**: incremental, idle/battery-gated background pass (indexer pattern); per-deck and per-card views; bounded work per run.

### 2. Proposal engine
- Each finding → `CardMaintenanceProposal { id, kind: rewrite|split|merge|retire|generate_application|generate_prerequisite|flag_outdated|clarify, target_card_ids[], evidence (review records, clusters, sources), draft_content? (for rewrite/split — model-generated), confidence }`.
- Model-assisted drafts (rewrite for clarity, split into minimum-information cards, application/prerequisite variants) reuse 13's generator tasks with form constraints; drafts are suggestions in an editable diff view.
- **Safety invariants**: proposals never auto-apply (unless user enables per-kind auto-apply in settings — default all-off; even then `retire` and `merge` never auto-apply); review history is never rewritten (rewrites supersede via new card versions with lineage links, preserving history integrity for scheduler truth).

### 3. UX
- **Deck health section** (per deck + global): findings list grouped by kind with severity; card detail view shows maintenance history.
- **Proposal review flow**: diff-style preview (before/after for rewrites; grouping visualization for merges; side-by-side for same-fact), evidence inspector (which fails, which sources), actions: apply / apply-edited / dismiss (with fingerprint dedup) / snooze.
- Batch review for same-fact groups ("review 3 groups" flow). E-ink-friendly text rendering.
- Post-session: at most one summary line ("2 cards look problematic — review suggestions?").

### 4. Card versioning (data)
- `card_versions` linkage (additive migration): rewrites/splits create new cards linked to predecessors (`supersedes` edges), preserving scheduling history and audit; merges union provenance (13's invariant). Retirement = suspend + archived state, reversible.

### 5. Hosted tier
- Rule-based detection: local, Free. Model-assisted draft quality (rewrites, splits, application generation): `card_optimizer` capability (quota: proposals drafted/month); content = card text + review aggregates (disclosed); exclusion honored.

## Impact

### Affected Specs
- `flashcard-lifecycle-optimization` — New (detectors, proposal kinds, safety invariants, versioning lineage, quotas).

### Affected Code Areas
- New `src-tauri/src/card_maintenance/` + commands; migration (`card_maintenance_proposals`, `card_versions` — next free numbers); `src/stores/cardMaintenanceStore.ts`; deck-health UI (`components/review/` additive sections); i18n.

### Non-goals
- No scheduler changes (FSRS/SM untouched — history integrity preserved), no cross-user benchmarks, no automatic anything by default, no deck restructuring beyond explicit actions.

## Dependencies

### Hard dependencies
- 13 (provenance/source_ref/forms + duplicate primitives). Soft: 7 (embeddings), 9 (concept aggregation), 15 (surfaces deck health metrics — coordinate mounts).

### May run concurrently
- 15 (file-disjoint in `knowledge_health/` vs `card_maintenance/`; Analytics mounts coordinated).

### Must not start yet
- —.

## Shared interfaces
- `list_maintenance_proposals`, `apply/dismiss/snooze` commands; `card_versions` lineage queries (consumed by 15 analytics); proposal events for deck-health surfaces.

## Ownership boundaries
- **May modify**: new maintenance modules/UI/migrations, deck detail additive sections.
- **Must treat as external**: review/scheduling internals (read-only queries), card generation tasks (13's APIs), graph schema (9).

## Collision risks
- AnalyticsPage/deck-detail mounts (15 — additive); migration numbering; `learning_items` table (only additive columns if needed — prefer separate tables).

## Integration contract
- Consumes 13's duplicate/primitive APIs read-only; emits `maintenance-proposal-available` events; version lineage queryable by 15.

## Testing & acceptance

### Tests
- Detector fixtures: synthetic review histories per finding kind (seeded) → correct detection, no false positives on healthy fixtures.
- Safety invariants: no auto-apply defaults; retire/merge never auto-apply in any configuration; history immutability (rewrite keeps old card's review rows intact and queryable).
- Merge provenance union; supersede lineage correctness (splits → children linked; retire reversible).
- Dismissal fingerprints (no re-proposal without new evidence); snooze windows.
- Post-session single-line cap; no mid-session surfaces.
- Quota: hosted draft counting; rule-based detection works Free.

### Acceptance criteria
- A degraded fixture deck produces accurate, evidence-linked, editable proposals; applying a rewrite preserves history + lineage; default configuration never changes a card without confirmation; local mode fully functional.

### Must remain unchanged
- Scheduler outputs for unchanged cards; existing review flows; perf gates.

## Open questions
1. Detector thresholds (fail counts, effort percentiles) — conservative defaults, settings-exposed.
2. Auto-apply scope limits (if ever enabled: only `clarify` drafts? product decision).
3. Stale-source detection depth (edition lineage heuristics v1: same-title+author version change only).
