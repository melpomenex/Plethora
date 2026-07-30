## 1. Sync Diagnostics Summary

- [x] 1.1 Add collapsed-by-default diagnostics state and a compact summary derived from the latest telemetry sample, phase count, and error state in `src/components/settings/SyncSettings.tsx`.
- [x] 1.2 Render expanded telemetry details in a bounded scroll container with the latest configured detail rows, accessible disclosure semantics, and no page-wide table growth.
- [x] 1.3 Keep `Copy report` sourced from the full retained telemetry/startup-request collections and preserve success/failure feedback when diagnostics are collapsed.
- [x] 1.4 Add/update localized labels for the summary, disclosure, recent activity, and error state, using the project’s existing i18n conventions.
- [x] 1.5 Add component tests covering initial collapsed state, accessible expansion, bounded detail rendering, error summary behavior, and full-report copying.

## 2. Real-Time Sync and Tab-Switch Performance

- [x] 2.1 Add development/test-only tab-switch timing and sync-backlog instrumentation using the existing sync telemetry patterns, including a baseline scenario with rapid switching and real-time sync disabled/enabled.
- [x] 2.2 Reproduce and identify the active long-task sources during rapid tab switching, then document the measured path in test comments or the implementation notes before changing scheduling behavior.
- [x] 2.3 Update `ProgressiveSyncScheduler` and sync enqueue sites so non-urgent projections, file registration, and store refresh work yield whenever input is pending, while preserving retry, ordering, clock checks, and eventual drain behavior.
- [x] 2.4 Coalesce bursts of remote document/projection work and debounce the resulting Documents-store reload so a multi-key update does not trigger one full reload per key.
- [x] 2.5 Replace frequent direct `saveTabs()` calls with a deduplicated trailing workspace-snapshot writer in `src/stores/tabsStore.ts`, flush it on pagehide/visibility loss, and retain immediate persistence for structural tab operations where required.
- [x] 2.6 Remove JSON serialization from the `TabContent` memo comparison and use stable immutable data/reference comparison without unmounting inactive tabs or regressing explicit tab-data updates.
- [x] 2.7 Add scheduler, document-reload coalescing, workspace-persistence, and tab-wrapper regression tests, including the guarantee that active-tab updates do not await background sync work.
- [x] 2.8 Run the rapid-switch stress fixture with 30–50 open tabs and a queued remote-update burst; verify the p95 activation-to-paint target, no repeated full reload storm, and eventual sync convergence.

## 3. Documents Range Selection

- [x] 3.1 Add a pure ordered-range selection helper with anchor, target, filter visibility, direction, duplicate-ID de-duplication, and modifier-toggle semantics, plus unit tests for inclusive forward/reverse ranges and missing anchors.
- [x] 3.2 Extend `DocumentsView` selection state with an anchor and derive the de-duplicated ordered document IDs from the active filtered/sorted desktop view.
- [x] 3.3 Integrate Shift/Cmd/Ctrl modifier handling into grid, compact/list, and horizontal card click targets and checkboxes while preserving single click, double-click/open, context-menu, and existing mobile behavior.
- [x] 3.4 Reconcile or clear the selection anchor when filters, sort order, collection, or view mode changes, and verify bulk actions continue to consume the existing selected-ID set.
- [x] 3.5 Add component tests for grid/list/card range selection, reverse ranges, endpoint changes, duplicate sections, filtering/sorting transitions, checkbox parity, and Cmd/Ctrl toggles.

## 4. Verification and Handoff

- [x] 4.1 Run focused SyncSettings, scheduler/sync, tab-store, Documents selection, and existing related test suites; fix regressions before broader validation.
- [x] 4.2 Run lint/typecheck/build validation appropriate to the frontend changes and confirm no new runtime dependency or data migration is introduced.
- [ ] 4.3 Manually verify Sync settings stays compact, diagnostics copy remains complete, real-time sync converges while switching tabs, session restore works after restart, and Documents Shift-click behaves correctly on macOS and Windows/Linux modifier conventions.
