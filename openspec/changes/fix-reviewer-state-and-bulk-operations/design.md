# Technical Design: Reviewer State and Bulk Operations

## Architecture & Persistence Contracts

1. **Transactional Bulk Deletion (`BUG-03`):**
   - `src-tauri/src/commands/queue_bulk.rs::bulk_delete_items` MUST execute each `QueueEntityKind::LearningItem` deletion inside a SQLite transaction that unlinks any `element_tree` node, journals a `SyncOperation::Delete` tombstone in `sync_outbox`, deletes the `learning_items` row (cascading `review_results` / `review_log`), and updates `documents.learning_item_count`. Missing IDs are recorded in `failed`/`errors` without corrupting valid deletions.
   - `src/lib/browser-backend.ts` MUST register `bulk_delete_items` mirroring Tauri's `BulkOperationResult` contract.
   - `DeckManager.tsx::handleBulkDelete` MUST filter only `result.succeeded` IDs from `allCards`, surface `result.errors` if `result.failed.length > 0`, and call `useQueueStore.getState().removeItemsLocally(result.succeeded)`.
   - `DeckManager.tsx::handleCardMoveToDeck` MUST call `updateLearningItemTags(cardId, newTags)` instead of IndexedDB `lib/database.ts`.

2. **Canonical Queue Completion Sync (`BUG-05`):**
   - When `QueueScrollPage.tsx::handleRating` completes a flashcard (`rating >= 1`), document, or extract:
     - If the item's new `dueDate` is still within the active queue window (e.g., `Again` / same-day relearning), call `useQueueStore.getState().applyItemDelta(id, { dueDate, ... })`.
     - Otherwise (item graduated past the active due window), call `useQueueStore.getState().removeItemsLocally([id])` (and `useReviewStore.getState().removeCardLocally?.(id)`).
   - Viewing or skipping an item in Scroll Mode MUST NOT record a review or remove the item from the due queue.

3. **Tag Persistence & Store Reconciliation (`BUG-06`):**
   - `src/lib/tagEditing/storeReconciliation.ts::applyItemTagsToStores` MUST also reconcile `useReviewStore` (`currentCard` and `queue` items matching `id` when `itemType === "learning-item"`).
   - `ReviewCard.tsx` and `CardPreviewPanel.tsx` MUST pass `onTagsPersisted` to `CompactTagEditor`.
   - `CardPreviewPanel.tsx::EditTab.handleSave` MUST pass `newTags` to `updateLearningItemContentWithVersion`.
   - `DeckManager.tsx::handleBulkRetag` MUST call `bulkUpdateItemTags` and revert on failure.
   - `useItemTagEditor.ts` MUST update local `tags` optimistically on `addTag`/`removeTag` and roll back with an error toast if `persistItemTags` rejects.
