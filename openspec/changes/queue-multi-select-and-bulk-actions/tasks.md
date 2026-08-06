## 1. Selection model in the store

- [x] 1.1 Add `lastSelectedId: string | null` and `selectionBase: Set<string>` to `QueueState` in `src/stores/queueStore.ts` (revised from `lastSelectedIndex` — see design, the surfaces render different lists)
- [x] 1.2 Add `setSelectionFromClick(id, renderedIds, mods: { shift?: boolean; meta?: boolean })` resolving plain / range / toggle per `specs/queue-multi-select/spec.md`, including shift-with-no-anchor falling back to plain click and toggle moving the anchor
- [x] 1.3 Prune selected ids no longer present in `filteredItems` inside `applyFilters`, and drop the anchor only once the row it points at is gone
- [x] 1.4 Audit all callers of `selectAll` (one: `ReviewQueueView.tsx:118`), then remove the `itemType === "learning-item"` narrowing so it selects every item in `filteredItems`
- [x] 1.5 Clear `selectedIds`, `lastSelectedId`, and `selectionBase` on full queue reload in `loadQueue`, `loadDueDocumentsOnly`, and `loadDueQueueItems`
- [x] 1.6 Add unit tests in `src/stores/__tests__/queueStore.test.ts` covering forward range, backward range, successive shift-clicks re-deriving, additive toggle, toggle-deselect, filter drop, and reload clear

## 2. Selection wiring in the queue UI

- [x] 2.1 Add a row-level checkbox and `bg-primary/10 border-primary` selected styling to the queue rows in `src/routes/queue.tsx`
- [x] 2.2 Route row clicks through `setSelectionFromClick`, passing `e.shiftKey` and `e.metaKey || e.ctrlKey` and the row's index in the rendered list
- [x] 2.3 Add a header checkbox with an indeterminate state for partial selections, toggling select-all / clear
- [x] 2.4 Add a `Cmd/Ctrl + A` handler scoped to the queue list that bails when the event target is an `input`, `textarea`, or `contenteditable`
- [x] 2.5 Add an `Escape` handler that clears the selection on all three queue surfaces (`routes/queue.tsx`, `ReviewQueueView.tsx`, `MobileQueueView.tsx`), guarded by open dialogs and IME composition, with the bulk-action panel swallowing Escape in the capture phase so dismissing a panel does not cost the selection
- [x] 2.6 Apply the same row click, checkbox, and keyboard wiring to `src/components/review/ReviewQueueView.tsx` so both queue surfaces behave identically. (Escape was initially missed here and in `MobileQueueView` — added after the gap was reported, with tests confirmed to fail without the fix)
- [x] 2.7 Add component tests asserting shift-click range selection and that `Cmd + A` inside the search box does not alter the queue selection

## 3. Batch IPC commands

- [x] 3.1 Add `bulk_update_item_priorities(item_ids, slider)` to `src-tauri/src/commands/queue_bulk.rs`, resolving types via `resolve_queue_entities`, running in one transaction, returning `BulkOperationResult`. Learning items have no priority column, so they report as failures
- [x] 3.2 Add `bulk_postpone_items(item_ids, days)` for fixed day shifts, honoring `interval_modifier` for documents. Smart postpone stays in the frontend `postpone` engine that already owns the priority-weighted formula, rather than being reimplemented in Rust
- [x] 3.3 Add `bulk_set_item_lifecycle(item_ids, transition)` for `done` / `dismiss` / `forget`. Resolved design Open Question 1: `done`/`dismiss` map to every type (archive/dismiss/suspend); `forget` is a no-op on extracts, which hold no memory state of their own
- [x] 3.4 Add `bulk_move_items_to_collection(item_ids, collection_id)`, asserting it never creates a collection
- [x] 3.5 Add `bulk_update_item_tags(item_ids, add, remove)` treating redundant adds and absent removes as per-item no-ops rather than errors
- [x] 3.6 Register all five commands in `src-tauri/src/lib.rs`
- [x] 3.7 Add Rust tests in the existing `bulk_item_tests` module: unknown ids reported in `failed`, mid-batch failure leaving no partial write, and mixed-type batches resolving correctly
- [x] 3.8 Add matching typed wrappers in `src/api/queue.ts`

## 4. Optimistic patching

- [x] 4.1 Add `applyItemDeltas(ids: string[], updates: Partial<QueueItem>)` to `queueStore` doing one `items.map()` against a `Set` and one `applyFilters()`
- [x] 4.2 Add a shared bulk dispatch helper that snapshots only the selected items' pre-change values, patches optimistically, dispatches, rolls back exactly the ids in `BulkOperationResult.failed`, and sets `hasLocalDeltas: true` on success
- [x] 4.3 Align `bulkSuspend`/`bulkUnsuspend`/`bulkDelete` selection-state clearing with the helper. They were *not* folded into `runBulkPatch`: those three remove rows, the helper patches fields in place, and widening it to do both would add a branch for no gain
- [x] 4.4 Add store actions for priority, postpone, lifecycle, move, and tags on top of the helper
- [x] 4.5 Clear the selection after each successful bulk mutation
- [x] 4.6 Add tests for optimistic patch, full rollback on rejection, and partial rollback on a mixed `BulkOperationResult`

## 5. Bulk action bar

- [x] 5.1 Rewrite `src/components/queue/BulkActionBar.tsx` as a floating bottom-center glass bar, replacing the `sticky top-0` banner, keeping the existing `useI18n` keys where they still apply
- [x] 5.2 Add the selection counter badge and close control
- [x] 5.3 Add the Bulk Priority control accepting 0–100 with client-side range validation
- [x] 5.4 Add the Bulk Postpone control offering +1/+3/+7/+30 and Smart Postpone
- [x] 5.5 Add Bulk Move to Collection, sourcing targets from the existing collections list
- [x] 5.6 Add the Bulk Tag editor supporting simultaneous add and remove
- [x] 5.7 Add Bulk Lifecycle with Done / Dismiss / Forget, gating Forget behind a confirmation that states it discards scheduling history and is not undoable
- [x] 5.8 Add Bulk AI Flashcard Studio, enabled only for all-extract selections, passing the combined extract texts as generation context
- [x] 5.9 Add Bulk Delete with a count-stating confirmation dialog. **Undo deliberately omitted**: `bulk_delete_items` hard-deletes every type (`repository.rs:1683` / `:2122`) and there is no soft-delete column, so an Undo button could only pretend to work. The confirmation states permanence instead. Restoring Undo needs a soft-delete backend — out of scope
- [x] 5.10 Disable each action when it does not apply to every selected item's type, surfacing the reason on hover
- [x] 5.11 Add the new i18n keys to all 6 locale files (30 `bulkAction.*` keys plus `common.apply`, `queue.sortOverdue`, `viewer.extractFailed`). Non-English locales carry English text pending translation
- [x] 5.12 Add component tests for the applicability gating and for the delete confirmation stating the correct count

## 6. Extract Mode toggle

- [x] 6.1 Traced: all four viewers funnel through `updateSelection` (`DocumentViewer.tsx:1119`) into `selectedText`/`activeExtractSelection`, so one gate covers PDF, EPUB, Markdown and HTML
- [x] 6.2 Gate the shared selection state on `isExtractMode` via `shouldAutoExtract`, calling the same `createInstantExtract` the manual button uses; inactive keeps the existing floating button
- [x] 6.3 Position metadata unchanged — the auto path reuses `computeExtractPageNumber({ selectionContext, ... })` and passes `selectionContext` through, exactly as the manual button does
- [x] 6.4 Success toast comes from `createInstantExtract`; failure surfaces `viewer.extractFailed` (new key, 6 locales) rather than failing silently — there is no button to retry with in this mode
- [x] 6.5 Added an effect resetting `isExtractMode` when `viewMode` leaves `document`; state is per-viewer-instance so unmount already clears it
- [x] 6.6 Extracted the decision to `src/components/viewer/extractModeGate.ts` and unit-tested it (5 cases). Mounting the ~7000-line DocumentViewer for this one branch was not worth the mock surface

## 7. Overdue sort

- [x] 7.1 Add `overdue` to the `SortOptions` field union in `src/types/queue.ts`
- [x] 7.2 Implement the comparator using `max(0, floor((now - dueDate) / 86400000))`, matching `reviewUx.ts:111`, treating a null `dueDate` as 0 and falling through to the existing default comparator on ties
- [x] 7.3 Add the option to the queue sort control, confirming it persists with the other sort options
- [x] 7.4 Add tests for descending order, ascending order, null-due-date placement, and tie stability

## 8. Performance touch-ups

- [x] 8.1 No migration needed — `idx_learning_items_type ON learning_items(item_type)` already exists in migration `074_add_composite_indexes`, alongside `idx_documents_due`. PRD Bug 1.2 is fully covered; adding another index would be a duplicate
- [x] 8.2 Narrow the six whole-store subscriptions to property selectors: `MobileLayoutWrapper.tsx:24`, `useQueueNavigation.ts:33`, `ReviewSession.tsx:97`, `AlgorithmArenaDecision.tsx:70`, `DeckManager.tsx:62`, `ZenReviewMode.tsx:311`. Three were single-field (plain selector), three destructured 10-21 fields (`useShallow` object selector)
- [x] 8.3 Measured `applyFilters` against the PRD's 50ms target — comfortably inside it, so no further optimization was warranted:

  | items | applyFilters | search change | overdue sort | applyItemDeltas (half) |
  |---|---|---|---|---|
  | 500 | 0.04ms | 0.05ms | 0.80ms | 0.79ms |
  | 2000 | 0.11ms | 0.11ms | 4.86ms | 4.43ms |

  Sorting dominates, as expected — the filter pass itself is negligible. The batched `applyItemDeltas` costs about one sort; the per-item loop it replaces would have cost 1000 of them at n=2000.

## 9. Triage for unconfirmed PRD bugs

- [x] 9.1 **Did not reproduce statically.** The `#` path is wired end to end in both consumers: `AssistantPanel.tsx:316` and `DocumentQATab.tsx:187` both call `useDocumentSections`, pass `flat` into `SectionMentionPopup`, and reach `buildSectionFocusedContext`. Content loading is async but mount-guarded (`AssistantPanel.tsx:331-341`), so there is no obvious race. Confirming the reported symptom needs a runtime repro against a real document, which cannot be done headlessly.

  Two real defects found while reading, one fixed:
  - **Fixed:** `hashContent` hashed only the first 2000 chars, and that value is a *cache key* — any edit past char 2000 that left the length unchanged returned stale sections. Now strides across the whole string, still O(2000).
  - **Left with a `ponytail:` marker:** `normalizeContent` truncates `Uint8Array` input to 10KB, so a byte-passing caller would silently get sections for only the first 10KB. Both current callers pass decoded strings, which is why it has not bitten.
- [x] 9.2 **Did not reproduce statically; no speculative change made.** `WebBrowserTab` already handles `tauri://error` (`:953`), renders an "Open in Browser" fallback (`:1472`), and has a reader-view fallback for blocked iframes (`:1486`). Capturing the real failure needs a running Tauri app against a live URL.

  One plausible unhandled path noted for whoever repros it: `webviewError` is set *only* from `tauri://error`. A webview that is created successfully but paints blank — the usual symptom of a protocol-routing problem — fires no error, so the user gets an empty pane with no fallback and no message. That is a hypothesis to test first, not a confirmed cause.

## 10. Verification

- [x] 10.1 Run `npm test` and `cargo test` and confirm both pass
- [x] 10.2 Acceptance criteria verified by test:
  - Shift-click contiguous range — `queueStore.test.ts` (forward, backward, re-derive, no-anchor) plus `ReviewQueueView.test.tsx` asserting the surface passes its own rendered order
  - One IPC call per bulk action — `"dispatches exactly one call for the whole selection"`
  - Zero-flashcard session integrity — unchanged; `ReviewQueueView.tsx:418-424` still hard-post-filters `itemTypes` and its 3 session-customization tests still pass
  - Extract navigation precision — `focusedExtractId` threading untouched (`QueueTab.tsx:41`), `QueueTab.test.tsx` green
- [x] 10.3 Regression check clean. Frontend 1985 passed / 7 failed, Rust 436 passed / 0 failed. The 7 frontend failures are **pre-existing** — verified by stashing the whole change and re-running: the same 8 files failed identically on a clean tree (deltaLog/sync suites needing a live server, `ReviewHome.deckStats`, `DeltaLogMigrationPanel`). Test count rose 1951 → 1985, all 34 new.

  The `selectAll` widening was the one behavior change to existing code; its single caller (`ReviewQueueView.tsx`) has 18 passing tests including the pre-existing 13.
