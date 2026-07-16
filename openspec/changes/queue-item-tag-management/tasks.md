## 1. Backend: cross-type tag lookup

- [x] 1.1 Add `get_items_by_tag(tag: String)` Tauri command that queries `documents`, `extracts`, and `learning_items` via `json_each(tags)` for exact matches, returning `{ id, type, title, category }` per hit, sorted by type then title
- [x] 1.2 Register the command in the Tauri command handler list and add a Rust unit test covering: no matches, matches across all three tables, case-sensitivity of tag matching (exact match, not case-folded, matching existing tag storage convention)
- [x] 1.3 Add a frontend API wrapper (e.g. `src/api/tags.ts` or alongside `documents.ts`) exposing `getItemsByTag(tag: string)`
- [x] 1.4 (Discovered) Fix `repository.rs::update_learning_item` never persisting `tags` (computed but unbound in SQL); add `update_learning_item_tags` Tauri command since no generic tag-update endpoint existed for learning items

## 2. Frontend: tag add/remove in the Details popover

- [x] 2.1 Add tag input UI to `ItemDetailsPopover.tsx` (visible only for `document`/`extract`/`learning-item` types), reusing add/remove pill patterns from `EditExtractDialog.tsx`/`DocumentsView.tsx`
- [x] 2.2 Wire tag-add to the relevant `update_document`/`update_extract`/`update_learning_item_tags` call with optimistic update, duplicate/empty-value guards, and rollback + error toast on failure
- [x] 2.3 Wire tag-remove (× on pill) to the same update calls with optimistic removal and rollback + error toast on failure
- [ ] 2.4 (Deferred) Tag-name autocomplete suggestions — skipped for this pass; plain text input only. No behavior regression, but not implemented.
- [x] 2.5 Ensure RSS-type targets render tags as before (read-only, no input/remove controls)

## 3. Frontend: tag-browse modal

- [x] 3.1 Create `TagItemsModal` (or equivalent) using the existing `Modal.tsx` singleton (`showModal`/`ModalType`, size `md`), grouped by item type (documents / extracts / learning items)
- [x] 3.2 Wire tag pill click (view mode, not the remove control) to call `getItemsByTag` and open the modal with results, including an empty-state message when no other items match
- [x] 3.3 Wire each modal entry to navigate to/open its item (document/extract open their existing viewer route; learning-item opens its parent document), closing the modal on selection
- [x] 3.4 Add loading and error states for the `getItemsByTag` fetch inside the modal
- [x] 3.5 (Discovered) `<Modal />` (the `useModal()`/`showModal()` singleton) was never mounted anywhere in the app render tree — `src/main.tsx` had `<Toast />` but no `<Modal />`, so `modal.custom(...)` silently no-opped for every caller, not just this change. Mounted it alongside `<Toast />` in `src/main.tsx`.

## 4. Frontend: common actions row

- [x] 4.1 Add a common-actions row to `ItemDetailsPopover.tsx` surfacing postpone / dismiss-undismiss / delete
- [x] 4.2 Wire postpone to `postponeItemSmart` from `useQueueStore`, matching `QueueContextMenu.tsx` behavior, and refresh the popover's scheduling stats on success (wired via optional `onPostpone` prop at the QueueScrollPage call site, only supplied for document/flashcard items — extracts aren't postponable, matching `QueueContextMenu`'s existing `canPostpone`)
- [x] 4.3 Reuse the popover's existing dismiss/undismiss logic in the new actions row (document-only), removing any now-duplicated UI
- [x] 4.4 Wire delete to the same confirm-then-delete flow used in `QueueContextMenu.tsx`, closing the popover on successful delete (used the app's undoable-delete commands (`useUndoableOperations`) instead of raw delete calls for undo support, a strict UX improvement over `QueueContextMenu`'s plain delete)

## 5. i18n and polish

- [x] 5.1 Add new `itemDetails.*` translation keys for tag input placeholder/labels, tag-browse modal strings, and action-row labels/confirmations (English source strings only, matching the codebase's existing tolerance for missing non-English keys)
- [x] 5.2 Verified in the browser preview (web-mode): tag pills, add-tag input, and the Actions row (Dismiss/Postpone/Delete) render correctly inside the popover's existing responsive container; no layout regressions observed
- [x] 5.3 Verified: add-tag and remove-tag round-trip through `update_document` and persist to storage without closing the popover (confirmed via IndexedDB read-back in the browser preview); tag pill click opens the browse modal with the correct title and loading state

## 6. Testing

- [ ] 6.1 Add/extend Vitest coverage for `ItemDetailsPopover` tag add/remove (success and rollback-on-failure paths)
- [ ] 6.2 Add Vitest coverage for the tag-browse modal (fetch, empty state, navigation on click)
- [ ] 6.3 (Partial) Manually verified add-tag/remove-tag persist correctly via the browser preview (web-mode, `update_document`). Postpone/dismiss/delete and the tag-browse modal's data fetch could not be exercised in the browser preview because `get_items_by_tag` and `update_learning_item_tags` aren't implemented in the web-mode mock (`src/lib/browser-backend.ts`) — that mock is unrelated to the real Tauri/Rust backend, which is covered by the passing Rust unit tests in `src-tauri/src/commands/tags.rs`. Full desktop (`cargo tauri dev`) verification of postpone/dismiss/delete and the tag-browse modal's live data is still outstanding.
