## Why

Incrementum already records a surprising amount of per-item history — every queue rating measures dwell time, documents accumulate `total_time_spent`, and every flashcard review writes a `review_results` row with its rating, timing, and resulting due date — but almost none of it is visible. The Queue "Details" popover shows seven scheduling numbers (stability, difficulty, retrievability, next interval, due date, reps, lapses) and nothing about the time or effort the user has invested in that item. Users who care about their learning data have to export the database to answer "how long have I spent on this?"

Two of the tracking paths are also broken in ways that make the honest answer unavailable: `submit_extract_review` accepts the measured time as `_time_taken` and discards it, and the fully-built `reading_sessions` table, Tauri commands, and frontend API have **zero call sites** — so time spent reading outside the Queue is never recorded. Closing those gaps and surfacing the result turns a pile of dormant columns into the per-item statistics view a Plethora user expects.

## What Changes

**Make time tracking truthful (backend + reader):**

- Persist extract review time instead of discarding it: add a per-extract time accumulator and per-review rows so extracts have the same time/history story as flashcards and documents.
- Give documents a per-review history (rating, active time, progress delta, resulting interval) rather than only the running `total_time_spent` total, so a document's timeline can be drawn.
- Wire `startReadingSession`/`endReadingSession` into the reader so time spent reading a document outside the Queue is recorded, and feed it into the same total.
- Make accrued time *active* time: an idle-aware heartbeat replaces raw wall-clock, so a document left open overnight does not report 9 hours of study. Existing wall-clock `end_reading_session` duration becomes a fallback, not the primary source.

**Surface the data (frontend, two tiers):**

- **Tier 1 — the Details popover** gains a compact, scannable stats block above the scheduling grid: total active time, sessions/reps, average time per rep, and a one-line "invested since <date>" summary. It stays fast and fits the existing 384px panel and mobile bottom sheet.
- **Tier 2 — a full Item Stats modal**, opened from a "Full stats" action in the popover and lazily loaded. Sections: **Time** (total, by surface, per-session distribution, longest session, active vs. estimated reading time), **Schedule** (memory state, interval history, forgetting curve for this item, next-interval preview), **History** (per-review timeline with rating, time, and resulting interval; rating distribution; lapse markers; leech flag), and **Content** (word/char counts, progress, extracts and cards yielded, priority, tags, dates).
- Stats cover every item type the Queue routes: documents, extracts, flashcards, and RSS articles, with each type showing the metrics that exist for it and explicitly labelling metrics that do not apply or predate tracking — never a bare `--` or a fabricated `0`.
- The same surfaces are reachable from the Documents library, the Reader, and Flashcard Studio, not only the Queue.
- UX guarantees: human-formatted durations (`2h 14m`, never `8040`), progressive disclosure so the popover never becomes a scroll-heavy wall, keyboard and screen-reader access to every stat, a text/table fallback for each chart, and respect for reduced-motion.

**Non-goals:** collection-wide or global analytics (the Analytics page already owns that), any change to scheduling algorithms or intervals, and backfilling history for reviews that happened before this change.

## Capabilities

### New Capabilities

- `item-statistics`: the per-item statistics contract and its two surfaces — the compact summary block in the Details popover and the full Item Stats modal — including which metrics each item type exposes, how unknown/not-applicable metrics are presented, accessibility and formatting rules, and which surfaces can open it.
- `item-time-tracking`: truthful accumulation of *active* time per item across the Queue and the Reader, for documents, extracts, and flashcards; per-item review/session history rows that make a timeline drawable; and the idle rules that decide when time stops accruing.

### Modified Capabilities

- `document-rating`: the "Tracking Reading Time" requirement changes. Today a document's `total_time_spent` grows only by the wall-clock delta since it was opened or last rated in the Queue. It must instead accrue idle-aware active time from both the Queue and the Reader, so reading a document without rating it still counts.

## Impact

**Backend (Rust):**
- `src-tauri/src/commands/extract_review.rs` — stop discarding `_time_taken`.
- `src-tauri/src/database/migrations.rs` — new migration: extract time accumulator, per-item review/session history for documents and extracts.
- `src-tauri/src/database/repository.rs` — writers for the new columns/rows; per-item stats read queries.
- `src-tauri/src/services/position.rs` — reading-session duration becomes heartbeat-driven rather than pure wall-clock.
- New Tauri command(s) to return an aggregated per-item stats payload in one round trip.

**Frontend (TypeScript/React):**
- `src/components/common/ItemDetailsPopover.tsx` — summary block + "Full stats" action.
- New `ItemStatsModal` (lazily loaded) and its section components; reuse of existing analytics primitives (`StatCard`, heatmap/forgetting-curve patterns).
- `src/pages/QueueScrollPage.tsx`, `src/components/review/ReviewQueueView.tsx` — pass through the new surfaces; Documents library, Reader, and Flashcard Studio entry points.
- Reader components (`src/components/viewer/*`) — start/stop/heartbeat reading sessions.
- `src/api/` — new stats API module; `extract-review.ts` and `position.ts` updated.
- Duration formatting utility, shared with existing surfaces.
- i18n: new keys across all locale files (`en`, `de`, `es`, `fr`, `ja`, `zh`).

**Constraints:**
- Entry chunk budget is `1500000` bytes against a ~1439 KB actual — the stats modal and any charting must be code-split, not added to the entry chunk. Any intentional growth updates `scripts/bundle-budgets.json` in the same commit.
- The perf gate (`npm run bench:check`) must stay green; the stats query runs on popover open and must not regress queue interaction benchmarks.
- Migration must be additive and safe on existing databases; pre-change items simply have no history rows.
