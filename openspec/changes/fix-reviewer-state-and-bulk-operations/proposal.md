# Change: Fix Reviewer State, Queue Synchronization, and Bulk Operations

Covers **BUG-03** (bulk flashcard deletion in Reviewer), **BUG-05** (completed review cards persisting in Reading Queue after Scroll Mode), and **BUG-06** (Reviewer tag edits reverting).

## Why

1. **BUG-03 (Bulk flashcard deletion):** `DeckManager.handleBulkDelete` ignores `BulkOperationResult.failed` / `errors` from `bulk_delete_items`, `src/lib/browser-backend.ts` lacks a `bulk_delete_items` handler, `src-tauri/src/commands/queue_bulk.rs` deletes `learning_items` without unlinking `element_tree` nodes or writing `sync_outbox` tombstones, and `handleCardMoveToDeck` uses IndexedDB `lib/database` instead of the Tauri API (`"Failed to move card"`).
2. **BUG-05 (Completed review cards persist in Reading Queue):** `QueueScrollPage.tsx` `handleRating` (for flashcards, documents, and extracts) only updates Scroll Mode local state and never updates `useQueueStore`, while `ReviewQueueView.tsx` skips refetching on return.
3. **BUG-06 (Reviewer tag edits revert):** `ReviewCard.tsx`, `CardPreviewPanel.tsx`, and other local-state surfaces render `CompactTagEditor` without `onTagsPersisted` or `useReviewStore` reconciliation; `CardPreviewPanel.EditTab.handleSave` omits `newTags`; `DeckManager.handleBulkRetag` mutates only local state; and `useItemTagEditor` does not apply optimistic state before async persistence.

## What Changes

- **Transactional bulk deletion & move-to-deck:** Make `bulk_delete_items` in Rust unlink `element_tree` nodes, journal `SyncOperation::Delete` tombstones, and update document card counts transactionally; implement `bulk_delete_items` in `browser-backend.ts`; make `DeckManager.handleBulkDelete` inspect `BulkOperationResult` and report partial/full failures accurately; fix `handleCardMoveToDeck` to use `updateLearningItemTags`.
- **Canonical Scroll Mode -> Reading Queue synchronization:** Update `useQueueStore` (`removeItemsLocally` / `applyItemDelta`) when items are rated or completed in `QueueScrollPage.tsx` (without marking merely viewed/skipped flashcards as completed).
- **Durable Reviewer tag persistence & reconciliation:** Subscribe `useReviewStore` (and `DeckManager` / `CardPreviewPanel` / `ExtractsList`) to `subscribeItemTagsUpdated` and wire `onTagsPersisted`; pass `newTags` in `CardPreviewPanel.EditTab.handleSave`; persist `DeckManager.handleBulkRetag` via `bulkUpdateItemTags`; apply immediate optimistic state in `useItemTagEditor` with rollback on error.

## Scope & Non-Goals

- **In scope:** Reviewer Deck Manager bulk delete/retag/move, Review Mode & Deck Manager tag editing, Scroll Mode completion sync with `useQueueStore`, and regression tests.
- **Non-goals:** Redesigning the Deck Manager UI or changing FSRS rating intervals.
