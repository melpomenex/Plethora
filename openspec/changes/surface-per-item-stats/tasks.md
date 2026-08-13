## 1. Schema and data model

- [x] 1.1 Add a migration to `src-tauri/src/database/migrations.rs` creating `item_activity_log` (`id`, `item_type`, `item_id`, `surface`, `started_at`, `ended_at`, `active_seconds`, `rating`, `resulting_interval_days`, `progress_start`, `progress_end`) with indexes on `(item_type, item_id)` and `started_at`
- [x] 1.2 Extend the same migration with `extracts.total_time_spent INTEGER` and `reading_sessions.last_heartbeat_at TEXT`, additively — no table rebuild
- [x] 1.3 Add a Rust test asserting the migration applies cleanly to a database seeded with pre-change documents, extracts, and learning items, and that existing `documents.total_time_spent` values are unchanged afterwards
- [x] 1.4 Add the `ItemActivityEvent` model to `src-tauri/src/models/` with serde field naming matching the existing frontend convention

## 2. Backend write paths

- [x] 2.1 Stop discarding extract review time in `src-tauri/src/commands/extract_review.rs`: accumulate `extracts.total_time_spent` and write an `item_activity_log` row with `surface='queue'`, the rating, and the resulting interval
- [x] 2.2 Write an `item_activity_log` row for document ratings in `rate_document` and `rate_document_engaging` (`src-tauri/src/commands/algorithm.rs`), carrying rating, resulting interval, and progress delta, alongside the existing `total_time_spent` accumulation
- [x] 2.3 Add a `record_active_time` command that accepts `(item_type, item_id, surface, active_seconds, session_id?)` and applies a heartbeat flush: increments the item's cumulative total and, for reader sessions, updates `duration_seconds` and `last_heartbeat_at` on the open `reading_sessions` row
- [x] 2.4 Change `end_reading_session` in `src-tauri/src/services/position.rs` to prefer accumulated heartbeat seconds for `duration_seconds`, falling back to the existing wall-clock computation only when no heartbeat was ever recorded
- [x] 2.5 Add startup recovery that closes every `reading_sessions` row with `ended_at IS NULL`, using `last_heartbeat_at` as the end time, and make it idempotent across repeated launches
- [x] 2.6 Add Rust tests for: extract time is persisted and accumulates across two reviews; a heartbeat flush followed by a simulated crash preserves accrued seconds without adding the gap; startup recovery closes a stale session at its last heartbeat

## 3. Backend read path

- [x] 3.1 Add repository queries returning the summary payload per item type — cumulative active time, repetition/session count, average time per repetition, first and last interaction dates — using indexed lookups only
- [x] 3.2 Add a repository query returning the normalised event timeline: `item_activity_log` for extracts, `item_activity_log ∪ reading_sessions` for documents, `review_results` for flashcards, all mapped to one `ItemStatsEvent` shape and ordered chronologically
- [x] 3.3 Add the derived detail aggregates — time split by surface, longest/average/median session, rating distribution, lapse positions, leech flag against the configured threshold, interval history, and rank by time invested within the item type
- [x] 3.4 Expose `get_item_stats_summary` and `get_item_stats_detail` Tauri commands, register them in `src-tauri/src/lib.rs`, and have each metric carry its state (`value` / `untracked` / `notApplicable`) rather than a bare null
- [x] 3.5 Add Rust tests covering: a document with both reader and queue events returns them interleaved in chronological order; an item with no events reports its pre-existing total with an `untracked` history; a flashcard's timeline is read from `review_results` and is not duplicated

## 4. Frontend time tracking

- [x] 4.1 Add `useActiveTimeTracker` in `src/hooks/` accruing whole seconds only while visible ∧ focused ∧ not-idle ∧ foreground-item, with a 60 s inactivity threshold defined as a single exported constant
- [x] 4.2 Treat pointer movement, key presses, scrolling, rating actions, and media playback progress as engagement signals that reset the idle timer
- [x] 4.3 Flush accrued seconds every 30 s and additionally on blur, visibility loss, item change, unmount, and `beforeunload`
- [x] 4.4 Add unit tests with fake timers for: idle time is excluded; a blurred window accrues nothing; media playback keeps accruing without input; only the foreground item accrues when two are mounted
- [x] 4.5 Wire `startReadingSession` / `endReadingSession` / heartbeat into the reader so opening a document starts a session, active reading feeds it, and navigating away ends it
- [x] 4.6 Replace the Queue's wall-clock `startTimeRef` measurement in `src/pages/QueueScrollPage.tsx` with the tracker's active seconds, keeping the existing rating call signatures intact
- [x] 4.7 Add `total_time_spent` to the extract type and API surface (`src/api/extract-review.ts`, extract types) so the persisted value is readable on the frontend
- [x] 4.8 Add an integration test that reading a document in the reader without rating it increases its reported cumulative time

## 5. Stats API and formatting

- [x] 5.1 Add `src/api/item-stats.ts` wrapping both commands, with types mirroring the Rust payload including the per-metric `value` / `untracked` / `notApplicable` state
- [x] 5.2 Add a `useItemStats` hook that fetches the summary on popover open and the detail on modal open, refetching on each open so a rating performed in between is reflected
- [x] 5.3 Extend `formatDuration` in `src/utils/date.ts` with a compact variant that drops the seconds component above one hour, and add unit tests for `45s`, `12m 30s`, `2h 14m`
- [x] 5.4 Add a metric-rendering helper that maps each payload state to its presentation: a real value (including `0`), an explicit "not recorded" note, or omission — with unit tests for all three

## 6. Details popover summary

- [x] 6.1 Add the summary block to `src/components/common/ItemDetailsPopover.tsx` above the scheduling grid, showing at most six values: total active time, repetitions/sessions, average time per repetition, and an "invested since <date>" line
- [x] 6.2 Render the popover's existing content immediately and stream the summary in behind its own loading state, so opening latency is unchanged
- [x] 6.3 Verify the summary fits without scrolling in both the desktop popover and the mobile bottom-sheet layout
- [x] 6.4 Add a "Full stats" action to the popover that lazily imports and opens the stats modal
- [x] 6.5 Add component tests for the summary across all four item types, including the untracked-item case

## 7. Item Stats modal

- [x] 7.1 Add `ItemStatsModal` as a `React.lazy` module with the four labelled sections, omitting any section that has no data for the current item type
- [x] 7.2 Build the **Time** section: total, split by surface, session count, longest session, average and median session length, and actual-versus-estimated reading time for documents
- [x] 7.3 Build the **Schedule** section: memory state, current and next interval, due date, interval modifier, per-rating interval preview, and the retention curve for this item
- [x] 7.4 Build the **History** section: chronological timeline with date, active duration, rating, and resulting interval; rating distribution; lapse markers; leech indicator
- [x] 7.5 Build the **Content** section: creation and first-seen dates, item age, word and character counts, reading progress, extracts and flashcards yielded, priority, category, tags
- [x] 7.6 Hand-roll the rating distribution and activity strip as SVG/CSS in the style of `ReviewHeatmap`; reserve `recharts` for the interval-growth and retention curves so nothing lands in the entry chunk
- [x] 7.7 Add component tests per section, including the RSS case where the Schedule section is omitted entirely

## 8. Accessibility and surface reach

- [x] 8.1 Trap focus inside the modal, make every section and control keyboard reachable, and return focus to the triggering control on dismissal
- [x] 8.2 Give every chart an equivalent text or table representation announced to screen readers
- [x] 8.3 Suppress animated transitions under `prefers-reduced-motion`
- [x] 8.4 Add entry points from the Documents library, the Reader, and Flashcard Studio that open the same modal with the same values
- [x] 8.5 Add accessibility tests: keyboard traversal reaches every stat, focus returns on dismissal, chart alternatives are present

## 9. Localisation

- [x] 9.1 Add all new keys to `src/lib/i18n/locales/en.ts` as the source of truth
- [x] 9.2 Mirror the keys into `de`, `es`, `fr`, `ja`, and `zh` in the same commit, falling back to English text where translation is pending
- [x] 9.3 Verify no hard-coded user-facing strings remain in the new components

## 10. Verification

- [x] 10.1 `npm run test:run` green, including the new frontend suites
- [x] 10.2 `cargo test` green in `src-tauri`, including the new migration, write-path, and read-path tests
- [x] 10.3 `npm run lint` clean
- [x] 10.4 `npm run build:check` passes and the entry chunk stays within `scripts/bundle-budgets.json`; confirm the modal and recharts resolve to non-entry chunks
- [ ] 10.5 `npm run bench:check` green; if the heartbeat writes shift a queue benchmark intentionally, update `scripts/perf-baselines.json` in the same commit with the reason
- [ ] 10.6 Manual pass: read a document without rating it and confirm the time appears; leave an item idle past the threshold and confirm the idle period is excluded; force-quit mid-session and confirm accrued time survives without the gap; open stats for a pre-change item and confirm it reads "not recorded" rather than zero
