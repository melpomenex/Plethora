## Context

Incrementum’s Sync settings page currently reads the entire bounded-in-memory telemetry buffer (`MAX_SYNC_TELEMETRY_SAMPLES = 1000`) into a normal table. The table is useful for debugging but is not the primary sync control surface, so a busy session can push device pairing and real-time-sync controls far below the fold.

The real-time sync stack already has a cooperative `ProgressiveSyncScheduler`, phase telemetry, document replication, file-sync registration, and localStorage/session persistence. However, tab activation still calls `saveTabs()` synchronously, serializing the complete workspace on every switch. Background document projections and reloads can also be scheduled while the user is switching tabs. `TabContent` keeps inactive tabs mounted to preserve state, but its memo comparator serializes tab data while the tab list is being traversed. The design must reduce this contention without dropping remote updates or breaking session restore.

The Documents view already owns `selectedIds` and routes selection through `handleSelectRow`, but it only interprets Cmd/Ctrl as multi-select. All desktop surfaces pass through this handler, making it a suitable boundary for a shared ordered-range selection model.

## Goals / Non-Goals

**Goals:**

- Keep Sync settings compact at the default scroll position while retaining complete diagnostics access and copyable reports.
- Make tab activation an interactive-priority operation when real-time sync is enabled, with measurable protection from sync-induced long tasks.
- Preserve eventual replication, remote conflict handling, file-sync behavior, and session restore semantics.
- Add predictable Shift-click range selection across grid, compact/list, and horizontal document-card surfaces using the active visible order.
- Cover the new state transitions with deterministic unit/component tests and a repeatable manual stress scenario.

**Non-Goals:**

- Redesigning the rest of Sync settings, changing encryption, changing the sync protocol, or changing telemetry retention/export format.
- Moving Yjs, IndexedDB, SQLite, or React rendering into a new runtime or worker as a prerequisite; profiling may identify a narrowly scoped worker opportunity, but the first-line fix is scheduling/coalescing.
- Adding lasso selection, drag-to-select, or a new selection mode on mobile.
- Changing bulk action APIs or the meaning of selected document IDs.

## Decisions

### 1. Collapse diagnostics by default and cap the rendered detail viewport

`SyncSettings` will derive a small summary from telemetry (phase count, latest phase/outcome, and error indicator) and render the diagnostics card collapsed by default. A disclosure control expands a fixed-height, vertically scrollable detail region; the full in-memory sample set remains the source for `Copy report`, so collapsing the UI never discards evidence. The summary will not auto-expand on errors; it will surface the error state in-place so the page does not jump unexpectedly while the user is working.

**Alternative considered:** Render only the last N rows without a disclosure. Rejected because it hides useful context and makes the existing copy-report action harder to understand.

### 2. Protect tab activation with cooperative sync scheduling

Keep Yjs receipt and CRDT state changes correct, but classify database projections, file hashing, store refreshes, and other non-urgent follow-up work as cooperative background work. The scheduler will honor pending user input for every non-urgent lane, yield between bounded batches, and retain queued work for the next idle opportunity. Remote work may be deferred briefly while input is pending; it must not be dropped and must eventually drain.

Where the current document replication path enqueues a burst of per-key work, coalesce it by domain and schedule one debounced document-store reload after the persisted projections settle. Existing clock/conflict checks remain authoritative, so coalescing affects UI refresh frequency rather than replication correctness.

**Alternative considered:** Disconnect real-time sync while the user changes tabs. Rejected because it creates sync gaps and makes the feature feel unreliable; background work should yield instead.

### 3. Debounce workspace persistence and remove serialization from the hot path

Replace direct `saveTabs()` calls from frequent activation updates with a trailing persistence scheduler. The scheduler will deduplicate pending writes, serialize once after a short quiet window, and flush synchronously on `pagehide`/visibility loss where possible. The existing `incrementum-tabs` localStorage blocklist remains in place, so tab snapshots are not reintroduced into Yjs.

`TabContent` memoization will compare stable tab data references (or an explicit version) rather than JSON-stringifying each tab during activation. Inactive tab content remains mounted to preserve reader state, but inactive wrappers must not re-render solely because another tab became active.

**Alternative considered:** Unmount inactive tab content to reduce render work. Rejected because it would discard expensive reader state and regress tab-switch continuity.

### 4. Use a pure ordered-range selection model at the Documents boundary

Maintain the current selected ID set plus a selection anchor ID. The active Documents view will provide a de-duplicated ordered list of currently visible document IDs after filtering/sorting. A normal click selects one item and establishes the anchor; Shift-click selects the inclusive anchor-to-target range; Cmd/Ctrl-click retains toggle behavior. If the anchor is absent from the current view, Shift-click behaves as a normal single selection. Checkboxes and row/card click targets will pass the same modifier information so the behavior is consistent across surfaces.

**Alternative considered:** Let each card/list component calculate its own range. Rejected because the grid has multiple sections and can show the same document more than once; a single ordered model prevents inconsistent ranges and duplicate IDs.

### 5. Measure the fix with interaction-specific telemetry and tests

Add development/test instrumentation around tab activation and sync backlog state, using existing long-task and sync phase telemetry patterns. Verification will compare rapid-switch behavior with real-time sync disabled/enabled and with an artificial projection backlog. The implementation should demonstrate no synchronous workspace serialization or repeated full document-store reload in the click handler, and target a p95 tab activation-to-paint under 100 ms in the stress fixture on the development machine.

## Risks / Trade-offs

- **Deferred session snapshot can lose the last few hundred milliseconds of navigation after a crash** → Flush on pagehide/visibility loss and retain an explicit immediate-save path for structural tab changes such as close, split, or reorder.
- **Deferring remote projections can make a newly synced document appear a little later** → Keep Yjs state receipt immediate, bound the debounce window, expose existing sync status, and ensure queued work drains as soon as input is idle.
- **A stable-reference memo comparator could miss in-place tab-data mutation** → Update tab data immutably and add a test that an explicit data update still re-renders the affected tab.
- **Range selection order may surprise users when filters or sort change** → Define the order as the current rendered, filtered, sorted, de-duplicated order; clear or rebase the anchor when it is no longer visible and add tests for each transition.
- **Telemetry instrumentation can itself add noise** → Keep measurements bounded, development-focused where possible, and avoid retaining payloads or emitting per-switch native IPC logs.

## Migration Plan

No data migration or protocol migration is required. Ship the UI, scheduler, session-persistence, and selection changes together. Existing `incrementum-tabs` snapshots remain readable because their serialized shape is unchanged. Rollback is a code-only revert; the previous snapshot writer and click-toggle behavior can read all snapshots produced by the new code.

Before release, run the existing frontend test suite plus focused sync/document tests, then manually stress-test 30–50 open tabs with real-time sync enabled while replaying a multi-document update burst. Verify pairing, remote projection, tab restore after restart, bulk actions, and selection behavior on both macOS and Windows-style modifier conventions.

## Open Questions

- Confirm the final diagnostics detail-row limit and summary wording with the existing localization style; the initial design can use the latest 50 visible rows while copying all retained samples.
- Confirm whether the p95 interaction target should be enforced as a CI benchmark or remain a release/manual regression gate, since WebView performance differs materially by platform.
