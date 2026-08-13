## Context

See [proposal.md](proposal.md) — Why. The design-relevant state of the code today:

| Item type | Cumulative time | Per-event history | Where it is written |
|---|---|---|---|
| Document | `documents.total_time_spent` (seconds) | none | `rate_document` / `rate_document_engaging` add `request.time_taken` ([algorithm.rs:264](../../../src-tauri/src/commands/algorithm.rs), [:369](../../../src-tauri/src/commands/algorithm.rs)) |
| Flashcard | none (derivable) | `review_results` (rating, `time_taken`, `new_due_date`, `session_id`) | `create_review_result` from `submit_review` ([review.rs:522](../../../src-tauri/src/commands/review.rs)) |
| Extract | none | none | `submit_extract_review` binds the value to `_time_taken` and drops it ([extract_review.rs:22](../../../src-tauri/src/commands/extract_review.rs)) |

The Queue already measures dwell time correctly — `startTimeRef` in [QueueScrollPage.tsx:588](../../../src/pages/QueueScrollPage.tsx) is reset on every item transition and read at rating time ([:2970](../../../src/pages/QueueScrollPage.tsx)). It is pure wall-clock, so it counts idle time.

`reading_sessions`, its Tauri commands, and `src/api/position.ts` wrappers are fully implemented but have **no call sites in the UI**. The `daily_reading_stats` view built on that table therefore returns nothing, which means the reading-streak and reading-goals features are currently reading from an empty source. Wiring the reader fixes those as a side effect.

Constraints that shape the approach:

- Entry chunk budget is 1 500 000 bytes against ~1439 KB actual — roughly 60 KB of headroom.
- `recharts` already has its own manual chunk ([vite.config.ts:142](../../../vite.config.ts)), so charting in a lazily-imported module cannot grow the entry chunk.
- `npm run bench:check` gates performance; the Queue's interaction path is benchmarked.
- Six locale files must stay in sync (`en`, `de`, `es`, `fr`, `ja`, `zh`).

## Goals / Non-Goals

**Goals:**

- One place that answers "what do we know about this item", reusable from four surfaces.
- Time figures a user would defend as accurate — no idle inflation, no lost time on crash.
- The popover stays as fast as it is today; depth costs a click, not a delay.
- Additive migration. Nothing recomputes or resets existing totals.

**Non-Goals:**

- Syncing the new history across devices. `reading_sessions` is already local-only and the cross-device story for revlog is `review_results`, which is untouched here. Per-item activity rows stay local in v1.
- Backfilling history from `review_results` into a unified log — flashcard history is read from `review_results` in place.
- Any change to how intervals are computed. Time is recorded and displayed; it never feeds the scheduler in this change.
- Global/collection analytics — the Analytics page owns that.

## Decisions

### Active time is measured on the frontend, persisted on the backend

The frontend owns the signals that define engagement: `visibilitychange`, window focus/blur, pointer and key events, media `timeupdate`, and which tab is foreground. A shared `useActiveTimeTracker` hook accrues whole seconds only while *all* of visible ∧ focused ∧ not-idle ∧ is-foreground-item hold, and exposes the accrued count plus a flush callback.

Idle threshold: 60 s of no engagement event. Media playback progress resets the idle timer, so a 40-minute audiobook chapter counts even with no input.

**Alternative rejected — measure in Rust from command timestamps.** The backend cannot see focus, visibility, or scrolling, so it can only infer wall-clock, which is exactly the inaccuracy being fixed.

### Flush on a cadence, not only at the end

The tracker flushes accrued seconds to the backend every 30 s and additionally on blur, visibility loss, item change, unmount, and `beforeunload`. A hard crash therefore loses at most 30 s and can never inflate: nothing is written for a period that was never observed.

The open `reading_sessions` row carries a `last_heartbeat_at`. On startup, any session with `ended_at IS NULL` is closed using `last_heartbeat_at` as its end. This is what makes the "crash mid-session" and "stale open session" scenarios hold.

**Alternative rejected — flush only on close.** Simpler, but loses the entire session on crash, and the spec requires the accrued time to survive.

### One new event log for documents and extracts; flashcards keep `review_results`

New additive table `item_activity_log`:

```
id, item_type ('document'|'extract'), item_id, surface ('queue'|'reader'),
started_at, ended_at, active_seconds, rating (nullable),
resulting_interval_days (nullable), progress_start, progress_end (nullable)
```

Flashcard history is **read from `review_results`**, not copied. That table is already the revlog, is synced, and is consumed by analytics; forking its meaning into a second table would create two sources of truth for the same event and a sync divergence to reconcile forever.

The read command normalises both sources into one `ItemStatsEvent` shape, so the UI does not branch per item type.

**Alternative rejected — one unified log for all three types.** Cleaner on paper, but it either duplicates every card review or requires migrating `review_results` out of the sync protocol. Not worth it for a display feature.

### The reader writes `reading_sessions`, the queue writes `item_activity_log`

Reader sessions keep using the existing table so `daily_reading_stats`, streaks, and goals start working without touching them. `duration_seconds` becomes the *active* seconds reported by the tracker instead of the wall-clock difference computed in [position.rs](../../../src-tauri/src/services/position.rs); the wall-clock computation stays as the fallback when no heartbeat was ever received.

Documents therefore have two event sources (reader sessions + queue ratings). The read command unions them. This is a deliberate denormalisation, taken because the alternative — repointing `daily_reading_stats` at the new table — would rewrite the goals and streak feature inside a stats change.

### Denormalised totals for the fast path

`extracts` gains `total_time_spent`, mirroring `documents`. The popover summary reads only the item row plus a couple of aggregates, never the event log. Two commands rather than one:

- `get_item_stats_summary(item_type, item_id)` — the ≤6 values the popover shows. Indexed lookups only.
- `get_item_stats_detail(item_type, item_id)` — everything else, including the event timeline and the rank query. Called only when the modal opens.

This is what keeps the popover's open latency unchanged; the spec requires the popover to render immediately and the summary to stream in behind it.

### Modal is lazily imported; charts go in the recharts chunk

`ItemStatsModal` is `React.lazy`-imported from the popover's action handler. Because `recharts` is already isolated in its own manual chunk, charts inside the modal cannot grow the entry chunk. Simple visuals (rating distribution bars, the mini activity strip) are hand-rolled SVG/CSS in the style of the existing [ReviewHeatmap](../../../src/components/analytics/ReviewHeatmap.tsx), which uses no charting library at all — recharts is reserved for the interval-growth and retention curves where it actually earns its weight.

### Presenting unknown values

The stats payload distinguishes three states per metric rather than sending `null` for all of them: `notApplicable` (wrong item type — omitted from render), a real numeric value (including `0`), and `untracked` (the item predates recording — rendered as an explicit "not recorded before <date>" note). Encoding this in the payload rather than inferring it in the UI is what makes the "genuine zero vs. unknown" requirement testable.

### Duration formatting

Reuse `formatDuration` from [src/utils/date.ts:52](../../../src/utils/date.ts). It already produces `45s` / `12m 30s` / `2h 14m`. Extend it only if the stats view needs a compact variant that drops the seconds component above an hour.

## Risks / Trade-offs

- **Heartbeat writes add DB traffic while reading** → 30 s cadence, one small `UPDATE` per flush, on an indexed primary key. Benchmarked against the queue interaction suite before and after; `scripts/perf-baselines.json` updated only if the change is intentional and explained.
- **Two event sources for documents makes the timeline query a union** → contained in one Rust read command with a single normalised output shape; the UI never sees the split. Covered by a test that a document with both reader and queue events returns them interleaved in chronological order.
- **Idle threshold is a judgement call** → 60 s with media-playback exemption is the starting value, defined in one constant. If it proves wrong, it moves to settings later; it is not a schema decision, so changing it costs nothing.
- **Users may read the new totals as a behaviour change** ("my document says 12 minutes, it said 40 before") → totals only ever grow; existing values are never recomputed. Pre-change reviews simply have no event rows, and the UI labels that gap rather than implying zero.
- **Six locale files drift** → all new keys added to every locale in the same commit, English text used as the fallback where translation is pending, consistent with existing practice.
- **Rank/percentile query scans all items of a type** → single indexed `COUNT(*) WHERE total_time_spent > ?`, detail command only, so it never runs on the popover path. If it shows up in profiling it can be dropped without touching the spec.

## Migration Plan

1. Additive migration only: `item_activity_log` (+ indexes on `(item_type, item_id)` and `started_at`), `extracts.total_time_spent`, `reading_sessions.last_heartbeat_at`. No table rebuilds, no data movement, no destructive statements.
2. Existing rows are untouched. An item with no event rows reports its pre-existing total and an `untracked` history, which is exactly the state the UI is specified to render.
3. Backend read commands ship before the UI consumes them, so a partial build degrades to "no summary" rather than an error.
4. Rollback: the UI additions are removable independently; the migration is additive, so a reverted frontend leaves orphan columns and rows that cost nothing and are picked up again if the feature is re-applied.
5. Startup recovery for stale `reading_sessions` rows runs once per launch and is idempotent.
