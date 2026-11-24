## 1. Bulk Flashcard Deletion (BUG-03)
- [ ] 1.1 Update `src-tauri/src/commands/queue_bulk.rs::bulk_delete_items` to unlink `element_tree`, journal `SyncOperation::Delete` tombstones, and update document card counts transactionally.
- [ ] 1.2 Add `bulk_delete_items` handler to `src/lib/browser-backend.ts`.
- [ ] 1.3 Fix `DeckManager.tsx::handleBulkDelete` to inspect `BulkOperationResult`, remove only `succeeded` IDs, sync `useQueueStore`, and report partial/full errors.
- [ ] 1.4 Fix `DeckManager.tsx::handleCardMoveToDeck` to use `updateLearningItemTags` instead of IndexedDB `lib/database.ts`.

## 2. Scroll Mode Queue Synchronization (BUG-05)
- [ ] 2.1 Update `QueueScrollPage.tsx::handleRating` for flashcards, documents, and extracts to update `useQueueStore` (`removeItemsLocally` or `applyItemDelta`) upon completion.
- [ ] 2.2 Ensure skipping/viewing items in Scroll Mode does not mark them completed or remove them from Reading Queue.

## 3. Reviewer Tag Persistence (BUG-06)
- [ ] 3.1 Extend `storeReconciliation.ts` and `useReviewStore` to reconcile `currentCard` and `queue` tags on `subscribeItemTagsUpdated`.
- [ ] 3.2 Wire `onTagsPersisted` in `ReviewCard.tsx` and `CardPreviewPanel.tsx`.
- [ ] 3.3 Pass `newTags` in `CardPreviewPanel.tsx::EditTab.handleSave` and persist `DeckManager.tsx::handleBulkRetag` via `bulkUpdateItemTags`.
- [ ] 3.4 Apply optimistic state with rollback on failure in `useItemTagEditor.ts`.

## 4. Regression Tests
- [ ] 4.1 Add Rust unit/integration test for `bulk_delete_items` transactional deletion, tombstones, and partial failures.
- [ ] 4.2 Add Vitest tests for `DeckManager` bulk delete/retag/move, `QueueScrollPage` -> `useQueueStore` completion sync, and `useReviewStore`/`ReviewCard` tag persistence.
