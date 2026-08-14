## 1. Queue Filtering & Item Visibility Fixes

- [x] 1.1 Update `ReviewQueueView.tsx` `visibleItems` calculation to filter items when `queueFilterMode === "new-only"` (showing only items with `getQueueStatus(item) === "new"` or unreviewed/unscheduled items).
- [x] 1.2 Update `ReviewQueueView.tsx` `visibleItems` and `queueStore.ts` `applyFilters` so that "Due All" properly includes due documents, extracts, and learning items across all collection settings.
- [x] 1.3 Update Rust `get_due_learning_items` in `repository.rs` to fallback to items with default/NULL collection IDs when querying the default collection.
- [x] 1.4 Add unit tests for `visibleItems` filtering in `ReviewQueueView.test.tsx` for "New Only" and "Due All" filter modes.

## 2. Scroll Mode Empty State Recovery

- [x] 2.1 Update `QueueScrollPage.tsx` empty state (`!currentItem`) to render a "Customize Session" button and a "Reset All Filters" button alongside "Back to Queue".
- [x] 2.2 Add handler to reset item count filters and reload scroll items when the user clicks "Reset All Filters".

## 3. NotebookLM Connection & Notebook Listing Error Recovery

- [x] 3.1 Update `NotebookLMPage.tsx` `checkConnection` to catch errors or empty lists from `notebooklmListNotebooks()` when the CLI requires authentication.
- [x] 3.2 Display an error state with an explicit "Re-authenticate CLI" action when notebook listing fails despite `notebooklmHealth` reporting `connected: true`.
- [x] 3.3 Add unit/integration tests for NotebookLM page error recovery states.

## 4. Knowledge Universe WebGL Centering

- [x] 4.1 Update `engine.ts` `setData` and `resize` methods to ensure `orbit.target.copy(this.homeTarget)` reliably runs on initial load and resize, preventing node clusters from drifting to screen corners.
- [x] 4.2 Verify camera auto-framing and centering in `KnowledgeUniverse.test.tsx`.

## 5. Document Q&A # Section Mention Resolution

- [x] 5.1 Update `sectionIndex.ts` `resolveSectionFocusedContext` candidate search to ignore 0-prose Table of Contents matches and select actual chapter body headings.
- [x] 5.2 Add test cases in `sectionIndex.test.ts` for section mentions matching TOC entries versus chapter content.

## 6. Schedule Workload Header String Formatting

- [x] 6.1 Update `ScheduleWorkloadBand.tsx` to pass required template variables to `t("schedule.dailyAvg", ...)` and `t("schedule.peakDay", ...)`.
- [x] 6.2 Add/update unit test in `ScheduleView.test.tsx` to verify workload header text formatting.
