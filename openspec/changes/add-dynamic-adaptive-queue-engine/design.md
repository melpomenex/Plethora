## Context

See `proposal.md` — Why for motivation. What constrains the implementation:

**The ranker cannot own the sort.** `sort_queue_items` (`algorithms/queue_selector.rs:121`) applies a six-arm due/new/future-dated match, then priority descending, then due date ascending, and that shape is depended on by `get_due_queue_items_from_repo_at` (`commands/queue.rs:592`), `get_queue` (`:550`), `get_queued_items` (`:564`) and the scroll-mode path. Separately, `orderScrollItemsByCombinedCriterion` (`src/utils/queueScrollOrder.ts:231`) applies a proportion bias plus `stableJitter`, and `getPriorityScore` (`src/utils/reviewUx.ts:144`) is a dot product over a five-dimension `PriorityVector`. Three orderings already coexist. DAQE must become *the* scoring authority without forking a fourth.

**The AI spine forbids a second router.** `unified-native-on-device-ai`'s design decision is verbatim: *"Extend this spine. No second router."* All AI work goes through `runTask` (`src/lib/ai/tasks/runTask.ts:76`) with `resolveTaskRoute` selecting a provider, and `ai-task-architecture` requires schema validation with at most one repair retry.

**Per-item-type priority literals are the thing being replaced.** `queue.rs:191` (learning item), `:268` (extract), `:315` (video extract) each hardcode a base weight. They must all be removed, not shadowed.

**Telemetry already flows, but is lossy.** `useActiveTimeTracker` (`src/hooks/useActiveTimeTracker.ts:18`) exports `IDLE_THRESHOLD_MS = 60_000` as a hardcoded constant, ticks at 1 000 ms, flushes every 30 000 ms, and writes whole seconds through `record_active_time` → `item_activity_repository.rs`. `ActivityItemType` is `{Document, Extract}` — flashcards are deliberately excluded. `item_activity_log` has `progress_start`/`progress_end` but **no** scroll depth, interaction density, or exit action.

**Bundling is unforgiving.** `inlineDynamicImports: true` means one chunk. `scripts/bundle-budgets.json` and `scripts/perf-baselines.json` gate `npm run bench:check`.

**Migrations are append-only** `"NNN_snake_case"` entries in `database/migrations.rs`, tracked in `_schema_migrations`. Current tail is `116_add_learning_item_source_reference`.

## Goals / Non-Goals

**Goals:**
- One scoring authority with a pure, unit-testable core: `S(i)` is a function of plain data with no I/O, so it can be benched and property-tested in isolation.
- Every scoring input available today gets wired in, rather than left as dead maths (`relevance.rs` has no callers outside itself).
- Zero new infrastructure. No new router, no new migration framework, no new event bus.
- Works with the entire AI layer switched off.

**Non-Goals (design-level, beyond the proposal's):**
- Rewriting `combined_score`/`sort_session` into Rust. The proportion bias stays in TS where the scroll-mode bench already measures it.
- A second telemetry table for dwell events. Existing `item_activity_log` gains columns.
- Backfilling cached judgements for existing items on upgrade — cold cache is a supported steady state.
- Making `energyTarget` per-item-type or per-deck. One global target.

## Decisions

### D1 — `S(i)` lives in Rust as a pure function; the five terms are computed by mixed Rust/TS producers behind one trait

`algorithms/daqe/terms.rs` exposes five small producers — `SrsUrgency`, `GoalRelevance`, `EnergyFit`, `InterleavePenalty`, `FrictionPenalty` — each `(QueueItem, RankContext) -> TermValue`. `ranker.rs` only combines them. `QueueItem` (`models/queue.rs:5`) already carries `stability`, `difficulty`, `interval`, `retrievability`, `lapses`, `reps`, `priority`, `estimated_time`, `tags` — enough for `R_srs` with no new joins. `TagAffinityCache` moves from `relevance.rs` into the context, not into the producer.

*Alternative — do it all in TS* (where `PriorityVector` already lives): rejected. The `friction` term needs `is_postponed`/postpone counts and cluster membership, which are SQLite-backed; moving them to TS would mean shipping the whole collection graph to the webview on every rebuild. Rust keeps the hot path next to the DB.

### D2 — Reuse `getPriorityScore` as the `goalRelevance` producer instead of reviving `recommendation-queue-blending`

`recommendation-engine` is marked 43/43 complete, yet `relevance_score`, `relevance_computed_at`, and the `fsrs_priority * (1 - w) + relevance * 10 * w` blend appear **nowhere** in `src/` or `src-tauri/src/`. Its `relevance-scoring` weights (classifier 0.4, tag affinity 0.25, rating history 0.2, semantic 0.15, with proportional weight redistribution on missing signals, neutral 0.5 cold start, 7-day staleness) all exist and are tested in `relevance.rs` — adopted by `rss-semantic-preference-learning`, not by its own change.

*Decision:* `relevance.rs` becomes the `goalRelevance` producer, keeping its weight-redistribution behaviour, and `M_relevance` is its composite in `[0,1]`. DAQE does **not** resurrect the dead blend formula — `w_goal` replaces it, and `relevance-composite` covers the same ground at the right scale.

*Trade-off:* `relevance-scoring` and `recommendation-queue-blending` are dead spec
dirs under a completed change — `recommendation-engine` is marked 43/43 complete
while `relevance_score`, `relevance_computed_at`, and its blend formula appear
nowhere in `src/` or `src-tauri/src/`. This change **supersedes
`recommendation-queue-blending`**: `w_goal` replaces `relevance_weight`, and
`Repository::daqe_relevance` calls `compute_relevance` directly, so the signal
math `relevance-scoring` describes is now finally on a live path — through a
producer that exists, rather than a column and a blend that do not.

Note what this is *not*: `getPriorityScore` (`src/utils/reviewUx.ts:144`) was
considered as the DAQE producer for this term, and rejected — it is a TypeScript
five-dimension dot product, while the ranker is Rust by design D1. Using it would
have meant either shipping the collection graph to the webview every rebuild or
maintaining the term in two languages. `PriorityVector.userIntent` therefore
remains only in the legacy `orderQueueItems` path, which 9.4 folds into the
ranker's topic distribution. Asserting the two formulas agree is not a property
worth pinning: they measure different things.

**Implementation note (found while building task 2.9).** The fallback-equality
requirement — "with every non-SRS term neutral, ordering SHALL reduce exactly to
the existing due-first, priority-descending, due-date-ascending sort" — is *not*
satisfiable by any `0..1` score. `sort_queue_items` buckets items due / new /
future **before** applying priority and due date, which no linear combination of
normalized terms reproduces. `rank()` therefore detects `knobs.is_srs_only()` and
defers to the real comparator, still computing the SRS term so the breakdown stays
populated. Restating the comparator as arithmetic would have been lossy and a
second implementation to keep in sync — which is precisely the failure mode D1
exists to avoid.

**A third consequence — the provider boundary is the command boundary.**
The AI task spine (`runTask`, `resolveTaskRoute`, schema-validated structured
output) is frontend TypeScript. Rust therefore *cannot* call the decision model.
`rank_queue` takes the model's answers as command **input** (`ModelInput`, every
field optional) and owns everything else: urgency from scheduling state,
`relevance.rs` for the goal term, friction from telemetry, and the ranking. This is
what "extend this spine, no second router" means concretely — a Rust-side client
would have been the second router D4 rejected.

**A second, subtler consequence.** The two penalty producers must return *raw*
penalties. An earlier version pre-scaled them by their knob while the breakdown
also applied the knob as the term weight, applying it twice. That is invisible at
knob values 0.0 and 1.0 and silently over-penalises everywhere in between; the
friction test only caught it because it happened to use aggressiveness 1.0. The
single application point is now the weight in `TermBreakdown`, and both producers
are knob-independent.

### D3 — Interleaving is a soft penalty inside `S(i)`, not a post-sort rearrangement

`P_interleave` is derived from cosine similarity between item `i` and `H_recent`, scaled by `interleavingDiversity`, subtracted in score space — before the deterministic tie-breakers, so it can never push an item across a composition boundary (which is why the scenario asserts composition quotas survive).

*Alternatives rejected.* (a) Post-sort variety guard, à la `orderScrollItemsByPriority` / `MAX_SAME_TYPE_CONSECUTIVE = 3`: cheap, but it reorders items across the score bands the user can now see and explain, and it treats "same *type*" where DAQE needs "same *topic*". The shipped `scroll-session-unified-priority` spec already forbids a guard from reordering across priority boundaries, and the topic-level equivalent lives in `engaging_scheduler.rs` (`max_same_topic_streak`, topic-streak penalty −2.0) — DAQE takes its cue from there. (b) Reusing `CombinedSortConfig.targetTopicShare` (default 0.5) verbatim: that field is calibrated for the 0–10 band where a 15-point proportion bonus dwarfs the priority spread; on a 0–1 normalized sum it is negligible. It stays as-is for scroll-mode ordering and DAQE adds its own `1..5`-aware penalty. The `max_same_topic_streak` streak *feature* is reused for DAQE's `H_recent`.

### D4 — Decision-model judgements are `AITaskDefinition`s in the existing task layer, wrapped by a Rust-side trait

The provider contract lives in Rust as `DecisionModelProvider` with `evaluate_score` / `evaluate_choice` / `evaluate_noul`. Its default implementation is a Tauri command that maps each primitive onto a registered `AITaskDefinition` (`daqeDecisionTasks.ts`, modelled on `passageClassificationTask.ts`: `outputKind: "structured"`, an `AISchemaDescriptor`, a `validate` fn, `modelClass: "fast"`, a bounded `timeoutMs`) and calls `runTask` with the untrusted block wrapped by `wrapUntrustedBlock`. Registration and routing are the spine's: `registerTasks` and `resolveTaskRoute`.

*Alternatives rejected.* (a) A Rust `DecisionModelProvider` trait over the old `LLMProvider` stack (`src-tauri/src/ai/providers.rs:95`) — that path has no structured-output guarantee and would bypass `ai-task-architecture`'s validation rule. (b) A bespoke HTTP client for a GGUF/ONNX decision engine — D2 of `unified-native-on-device-ai` says Windows adds `AIProvider` implementations *in the same registry*; a bespoke client is the "second router" that decision forbids. A user-supplied local GGUF/ONNX engine is registered as a `LOCAL_MODEL_PROVIDER_ID` `AIProvider`, not as a parallel subsystem.

### D5 — Provider id and knobs live in the Zustand settings store under a `daqe` namespace

`settingsStore.daqe = { knobs: {...6...}, activePreset: <id|null>, decisionModelProviderId: <id|null>, allowRemoteDecisionModel: false }`. Defaults per `queue-mode-presets`. The existing `smartQueue.queueStrategyPreset` stays and keeps its five originals; the four DAQE presets are added to the same union so one dropdown serves both, matching `queue-strategy-persistence`'s description obligation.

`allowRemoteDecisionModel` defaults `false` and is the sanitization gate: when `false`, the remote branch is unreachable by construction rather than by a runtime check.

### D6 — Dwell telemetry extends `item_activity_log` rather than adding a table

Migration `117_daqe_queue_engine` adds nullable columns to `item_activity_log`: `scroll_depth_ratio REAL`, `interaction_density REAL`, `exit_action TEXT`, `idle_time_ms INTEGER`. `activeDwellMs` is already `active_seconds`. `Metric<T>` (`models/item_stats.rs:40`) — `{Value, Untracked, NotApplicable}` — is reused for reads, so "we never measured scroll depth for a flashcard" is `Untracked`, not `0.0`.

`117` also creates `daqe_model_cache` (`content_hash TEXT PRIMARY KEY, rubric_version INTEGER, score REAL, tier TEXT, gate REAL, computed_at TEXT`), `daqe_queue_snapshots` (`collection_id, profile, knobs_json, ranked_ids_json, term_breakdown_json, computed_at`), and the DAQE config JSON Schema is applied as a `CHECK`-adjacent validation in `settings_daqe_config` rather than as a DB constraint, so schema errors surface as typed errors in settings validation rather than as SQLite failures.

`AFK_THRESHOLD_MS` becomes a parameter of `useActiveTimeTracker` defaulting to `45_000`, with `IDLE_THRESHOLD_MS = 60_000` kept as a deprecated re-export so existing call sites (`useReadingSessionTracker`, `useQueueTimeTracker`, `useListeningSessionTracker`) keep compiling; each call site is migrated to pass the knob. The retro-clamp is a small change to the accrual branch at `useActiveTimeTracker.ts:181-195`.

### D7 — Ranking is a background task that publishes a snapshot; the UI reads the snapshot

`commands/queue_daqe.rs` exposes `rank_queue(collection_id, knobs) -> QueueSnapshot`. It runs on Tauri's async runtime (not the UI thread), writes `daqe_queue_snapshots`, and returns. `queueStore.reloadForCurrentMode` (`:422`, the single reconcile chokepoint) keeps serving the last snapshot while a re-rank is in flight, then swaps. `top_10` is returned alongside the full order so the 150 ms budget is only ever claimed for what the user sees next.

If no snapshot exists for the current knob signature, the store renders the pre-DAQE sort — a valid order, not an empty state.

### D8 — Cluster and velocity signals are computed from existing tables, on read

No new tables for clustering or baselines. `P_friction` reads `item_activity_log` aggregates plus postpone/dismiss counts. Cluster promotion reuses the existing semantic index and `neural_queue.rs`'s spreading activation (`ACTIVATION = 0.05`, probabilistic OR). Velocity is items-consumed-over-active-minutes against a trailing-30-day baseline held in the existing `study_statistics` rollup. If the sample is below the existing `hasSufficientData` threshold, the velocity term is `Untracked` and no energy downshift occurs — the same honest-small-sample rule as `knowledge-health-analytics`, whose *"No metric SHALL be a meaning-less composite score"* is why every term in D1's `TermValue` carries an `available` flag.

## Risks / Trade-offs

- **Three orderings already exist and DAQE must not add a fourth** → Collapse, do not wrap: `getPriorityScore` becomes the `goalRelevance` producer, and `orderScrollItemsByCombinedCriterion`'s proportion bias is applied *after* the ranker, reading the ranker's topic distribution rather than a priority scale. Phase 1 lands the ranker and benches it in isolation; the collapse is Phase 4 and is gated on `queueScrollOrder.bench.ts` baselines being updated in the same PR.
- **Removing the per-item-type priority literals could change ordering for users mid-session** → Ship behind the knob panel: on first run every profile gets `srsDecayWeight = 0.40` etc. with `daqe.rankingEnabled = false`, and the literal-based sort stays the default until the user opens the panel. Deleting the literals is Phase 4, after the fallback ordering is proven equal.
- **The 150 ms budget is unverified until measured** → `src-tauri/src/algorithms/daqe/ranker.bench.ts` seeds candidates with `seededRandom` and is gated by `npm run bench:check`; the baseline is recorded in Phase 2. If it fails, the escape is a partial sort (top-10 heap + full sort deferred), not a raised budget.
- **A decision model that returns plausible garbage is worse than none** → Schema validation catches shape, not truth. Mitigated by `evaluateNoul` being a separate cheap call, and by the complexity term reporting `defaulted` vs `measured` in the breakdown so a user can see when it came from a model.
- **`item_activity_log` growth** → Rows are already coalesced on a 300 s window (`ACTIVITY_COALESCE_WINDOW_SECONDS`); new columns ride along, and `idle_time_ms` replaces the bytes that a wall-clock total used to occupy.
- **Flashcards have no dwell** (`ActivityItemType` excludes them) → `P_friction` reports `Untracked` for a flashcard with no telemetry rather than imputing a value. Widening `ActivityItemType` is out of scope.
- **Remote-provider sanitization is enforced by construction, not by inspection** → When `allowRemoteDecisionModel` is `false` the outbound payload builder is not reached. The structural-outline payload builder is unit-tested against a body-text fixture asserting absence.

## Migration Plan

1. **`117_daqe_queue_engine`** — additive only: four nullable columns on `item_activity_log`, three new tables. No backfill, no rewrite of `documents`/`extracts`/`learning_items`. Reversible by dropping the new tables and columns; nothing pre-existing is modified, so rollback needs no data repair.
2. **Knobs land defaulted with `rankingEnabled = false`.** Existing users see byte-identical ordering. Rollback = flip the flag; no code revert needed.
3. **Phase 4 deletes the per-item-type priority literals** in `queue.rs:191`, `:268`, `:315`, `:703`, `:746` and collapses the three orderings. This is the only non-flag-gated step, so it ships only after the fallback-equality test passes.
4. **Cache warms lazily.** Cold cache is the designed steady state; the migration does not block first launch.

## Open Questions

- Should `goalRelevance` accept a free-text focus prompt in this change, or only the existing tags/rating/semantic signals? The tag/rating/semantic path reuses `relevance.rs` unchanged and is what the specs currently describe. Free-text prompt parsing would need its own rubric version and is deferrable without touching the specs.
- Whether the four DAQE presets should also appear in the `queuePreset.*` i18n namespace as new keys or as keys under a new `daqePreset.*` namespace. The spec requires a visible description per preset but does not name the key namespace; a translation-debt question, not an architectural one.