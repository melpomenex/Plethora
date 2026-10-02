## Why

Plethora's queue is ranked today by a fixed formula — FSRS/urgency plus a user priority slider, with a hardcoded per-item-type priority literal for every non-document item — and five named weight-vector presets that are never explained numerically. The queue cannot answer the only question a user actually has mid-session: *"what should I read right now, given what I am trying to learn and how much brain I have left?"* Three separate subsystems already hold the raw material for that answer (relevance signal math in `relevance.rs`, active-vs-idle dwell tracking in `useActiveTimeTracker`, engagement/variety scoring in `engaging_scheduler.rs`) and none of them feed the ordering. The result is that a tired user on a phone and a focused user at a desk get the same queue, and cognitive resistance is indistinguishable from forgetting.

The `recommendation-engine` change already claimed to solve this with a `relevance_weight` blend, but it was marked complete while none of its fields (`relevance_score`, `relevance_computed_at`, the blend formula) exist anywhere in `src/` or `src-tauri/src/`. DAQE is the real implementation of that intent, widened to cover cognitive load, interleaving, friction, and dwell evidence.

## What Changes

- **A single deterministic composite ranker** replaces the scattered per-item-type priority literals. For each due candidate the engine computes one score with five named, separately-inspectable terms:
  `S(i) = w_srs·R_srs(i) + w_goal·M_relevance(i) + w_fit·M_energy_fit(i,K_energy) − P_interleave(i,H_recent) − P_friction(i)`.
  Every term is normalized to `[0,1]` before weighting, and the ranker returns the per-term breakdown alongside the total so no score is ever a meaning-less number.
- **Six user-facing knobs** replace the single `queueStrategyPreset` dropdown as the primary control surface: `srsDecayWeight`, `goalRelevance`, `energyTarget` (1–5 integer), `interleavingDiversity`, `pruningAggressiveness`, `afkIdleTimeoutMs` (15 000–120 000, default 45 000). Knob changes re-rank without touching FSRS memory state.
- **A pluggable decision-model provider** contributes three primitives per item — `evaluateScore` (continuous 0–1: topical alignment, extractability, conceptual complexity), `evaluateChoice` (discrete tier: *Surface Skim* / *Medium Analysis* / *Deep Foundational*), `evaluateNoul` (binary gate: prerequisites met, stale pruning). It runs through the **existing AI task spine** (`runTask` / `resolveTaskRoute` / schema-validated structured output) — no second router. Results are cached in SQLite by content hash so only session-dependent variables re-infer.
- **Dwell telemetry that distinguishes active from idle.** `useActiveTimeTracker` gains a configurable idle timeout (today a hardcoded `IDLE_THRESHOLD_MS = 60_000`) and records a per-item contract: `activeDwellMs`, `idleTimeMs`, `scrollDepthRatio`, `interactionDensity`, `exitAction`. Idle blocks are retroactively clamped so absence never inflates a dwell figure.
- **Four curated presets** — *Deep Work Sprint*, *Tired / Mobile Commute*, *Ruthless Triage*, *Balanced Discovery* — that are plain knob vectors, added to the existing five `PriorityPreset` values rather than replacing them.
- **An adaptive learning loop without model fine-tuning**: high dwell + high extraction promotes an item's collection and semantic cluster; repeated rapid-skip or high-idle-without-interaction raises a `split-candidate` or `auto-demote` flag; sustained reading-velocity collapse below 40% of baseline shifts the effective energy target down.
- **Deterministic degradation is a requirement, not a hope**: an offline, failing, or timing-out decision model, a missing cache, or a knob set of all zeros must still produce a valid ordering from SRS maths alone, with no thrown error reaching the UI.
- **Performance is specified**: ranking never blocks the UI thread, and the top-10 next items are available within 150 ms of a queue rebuild.

### Non-goals

- Ranking does **not** pull documents into the flashcard review session — `flashcard-review-session` keeps the Review tab scoped to learning items.
- DAQE does **not** change FSRS, SM-18 (Plethora Adaptive) or SM-20 (Plethora Precision) scheduling, stability, difficulty, or interval maths. It ranks *what to surface*; the schedulers still decide *when it comes back*.
- DAQE does **not** change session **membership** (which items are eligible), only order — `add-queue-composition-sliders` owns composition.
- No cloud text leaves the device unless the user opts in, and opt-in payloads are structural outlines only.

## Capabilities

### New Capabilities

- `adaptive-queue-ranking`: The deterministic five-term composite ranker, its normalization, the energy-fit function, knob application, per-term explainability, the <150 ms non-blocking budget, and deterministic degradation to SRS-only ordering.
- `queue-decision-model`: The `IDecisionModelProvider` contract (`evaluateScore` / `evaluateChoice` / `evaluateNoul`), registration and routing through the existing AI task spine, content-hash SQLite caching, cloud-payload sanitization, and provider-failure fallback.
- `dwell-telemetry`: The active-vs-idle dwell contract, the AFK/idle state machine with configurable timeout, scroll depth and interaction density, exit actions, and re-engagement acknowledgement.
- `queue-mode-presets`: The knob schema and its validation, the four curated DAQE presets as weight vectors, and preset-to-knob application with user overrides.

### Modified Capabilities

- `queue-item-type-routing`: the "All three types selected" scenario currently names the retired flashcard-percentage / extract-budget settings as the ordering authority. It SHALL instead state that toggles and composition govern session **membership** while the adaptive ranker governs **order** within that membership.
- `queue-strategy-persistence`: the preset dropdown requirement enumerates exactly five preset ids and requires a `queuePreset.<name>Desc` description per preset. Four DAQE presets join that set and the preset surface becomes a full knob panel, so the enumeration and the description obligation both change.

## Impact

**New Rust modules** under `src-tauri/src/algorithms/`: `daqe/` with `ranker.rs` (pure `S(i)` maths, unit-testable, no I/O), `terms.rs` (normalizers + energy-fit), `decision_model/` (trait, registry, cache), and `dwell.rs` (AFK state machine). `commands/queue_daqe.rs` exposes the Tauri surface.

**New migration `117_daqe_queue_engine`**: tables `daqe_model_cache` (content-hash keyed), `daqe_queue_snapshots`, `daqe_dwell_events`; columns on `documents`/`extracts`/`learning_items` for cached `complexity_tier` and `friction_score`. Migrations are append-only `NNN_snake_case` in `database/migrations.rs`; `116_add_learning_item_source_reference` is the current tail.

**Frontend**: `src/lib/daqe/` (knob schema + presets + term-breakdown types), `src/components/queue/DaqeKnobPanel.tsx`, `src/pages/queueScrollDwellBridge.tsx`, extension of `useActiveTimeTracker`, and `settingsStore` additions under a new `daqe` namespace. New AI task definitions in `src/lib/ai/tasks/definitions/daqeDecisionTasks.ts` following `passageClassificationTask.ts`.

**Reused, not rebuilt**: `PriorityVector`/`getPriorityVector`/`getPriorityScore` (`src/utils/reviewUx.ts`), `CombinedSortConfig.targetTopicShare` + `MAX_SAME_TYPE_CONSECUTIVE` + `stableJitter` (`src/utils/queueScrollOrder.ts`), `combined_score`/`sort_session` (`algorithms/priority_queue.rs`), the four-signal relevance maths with weight redistribution (`algorithms/relevance.rs`), `EngagementPreferences.max_same_topic_streak` (`algorithms/engaging_scheduler.rs`), `sort_queue_items` (`algorithms/queue_selector.rs`), `get_due_queue_items_from_repo_at` (`commands/queue.rs:592`), and the whole `item_activity_log` write path (`item_activity_repository.rs`).

**Gates**: a new `src/lib/daqe/*.bench.ts` suite gated against `scripts/perf-baselines.json` via `npm run bench:check`, plus `scripts/bundle-budgets.json` if the knob panel and task definitions push the bundle — `inlineDynamicImports: true` means everything ships in one chunk.