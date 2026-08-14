## Context

GitHub Issue #44 identifies multiple distinct bugs across the application:
1. **Due All Filter in Queue**: Non-document items (flashcards, extracts) were missing when filtering by "Due All" because `ReviewQueueView.tsx` `visibleItems` filtering did not evaluate `queueFilterMode === "due-all"` properly, and Rust `get_due_learning_items` required exact collection ID matches which excluded items imported under default/NULL collection IDs.
2. **NotebookLM Connection State**: `NotebookLMPage.tsx` set state to "connected" based solely on health check success even when `notebooklmListNotebooks` failed or returned empty results due to CLI session expiration, leaving the user with an empty screen and no way to re-authenticate.
3. **Knowledge Universe Centering**: In `KnowledgeUniverse.tsx` / `engine.ts`, `setData` only updated camera `orbit.target` if `isAtHomeView()` was true. When canvas resized during tab transitions, `isAtHomeView()` failed, leaving `orbit.target` offset relative to `homeTarget` and clustering all nodes in the bottom-right quadrant.
4. **Scroll Mode "Nothing to Read" Trap**: When custom session filters set item counts to 0, Scroll Mode displayed a static empty state screen without any toolbar or settings controls, locking the user out of modifying filters.
5. **"New Only" Queue Filter**: `ReviewQueueView.tsx` `visibleItems` did not check for `queueFilterMode === "new-only"`, returning all loaded items regardless of whether they had review history, due dates, or progress.
6. **# Section Mentions in EPUB/Document Q&A**: Section resolution matched heading strings in the document's Table of Contents (which have zero prose body between TOC lines), causing `resolveSectionFocusedContext` to reject the section with "has no current document-text range".
7. **Schedule Header i18n Format**: `ScheduleWorkloadBand.tsx` passed `schedule.dailyAvg` and `schedule.peakDay` i18n keys without required template variables `{count}` and `{date}`, causing raw placeholder strings to render.

## Goals / Non-Goals

**Goals:**
- Fix `ReviewQueueView.tsx` `visibleItems` logic to respect `queueFilterMode === "new-only"` and `"due-all"`.
- Fix Rust collection ID matching in `get_due_learning_items` to fall back to default collection / NULL handling when appropriate.
- Provide error/login recovery state in `NotebookLMPage.tsx` when notebook listing returns empty or fails.
- Fix camera target updating in `engine.ts` so `orbit.target` reliably syncs to `homeTarget` when returning to or loading the galaxy graph.
- Add "Reset Filters" and "Customize Session" buttons to the Scroll Mode "Nothing to Read" view.
- Update `sectionIndex.ts` candidate selection to prefer section heading occurrences with non-empty prose over TOC entries.
- Pass required template variables to `t("schedule.dailyAvg")` and `t("schedule.peakDay")` in `ScheduleWorkloadBand.tsx`.

**Non-Goals:**
- Refactoring the entire FSRS algorithm or database schema.
- Redesigning the entire NotebookLM CLI protocol.

## Decisions

- **Decision 1: Queue "New Only" and "Due All" Filtering in Frontend**:
  - In `ReviewQueueView.tsx` `visibleItems`, add explicit filtering logic for `queueFilterMode`:
    - When `queueFilterMode === "new-only"`, filter `queueItems` to only include items where `getQueueStatus(item) === "new"` or `item.dueDate == null` / `reviewCount === 0`.
    - Ensure `effectiveItemTypes` does not inadvertently mask flashcards/extracts when "Due All" is active.
- **Decision 2: Backend Collection Fallback for Due Items**:
  - In `src-tauri/src/database/repository.rs`, update `get_due_learning_items` so that when querying a collection, it also includes items with `collection_id IS NULL` or `collection_id = 'default'` if the active collection is the default collection.
- **Decision 3: NotebookLM Auth Failure & Empty State Handling**:
  - In `NotebookLMPage.tsx`, if `notebooklmListNotebooks()` throws an auth/CLI error or returns empty when expected, set `connectionState` to `"error"` or `"disconnected"` with a "Re-authenticate CLI" action button.
- **Decision 4: Knowledge Universe Camera Target Alignment**:
  - In `engine.ts`, ensure `orbit.target.copy(this.homeTarget)` is executed when `setData` is called or when returning to home view, regardless of minor `isAtHomeView` floating-point discrepancies after canvas resize.
- **Decision 5: Scroll Mode Empty State Controls**:
  - In `QueueScrollPage.tsx`, update the `!currentItem` render block to include a "Customize Session" button and a "Reset All Filters" button alongside "Back to Queue".
- **Decision 6: TOC-Aware Section Resolution**:
  - In `sectionIndex.ts` `resolveSectionFocusedContext`, filter candidates to ignore matches that are part of a TOC block (e.g., heading matches whose range ends at another heading without any paragraph text), ensuring the candidate with actual chapter prose is selected.
- **Decision 7: Schedule Workload Band i18n**:
  - Update `ScheduleWorkloadBand.tsx` to supply `{ count: ... }` and `{ date: ... }` parameters to `t("schedule.dailyAvg", ...)` and `t("schedule.peakDay", ...)`.

## Risks / Trade-offs

- **[Risk]** Section mention candidate selection change might change resolution for short sections.
  - **Mitigation**: Only skip heading matches where body prose length after heading text is 0 characters before the next heading.
