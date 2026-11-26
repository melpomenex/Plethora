# Technical Design: Cross-Mode Review State Synchronization

## Fundamental Invariant

A flashcard has one authoritative persisted scheduling state (`LearningItem` in SQLite / browser backend). Review View, Zen Review, Scroll Mode, Reading Queue, and Quick Review are derived views that must reconcile against committed scheduling outcomes using canonical `LearningItem.id`.

## Architecture

1. **Canonical Reconciliation Module (`src/lib/reviewSync.ts`):**
   - `isItemDueNow(dueDate?: string | null, nowMs?: number): boolean` evaluates authoritative due eligibility (`!dueDate || Date.parse(dueDate) <= nowMs`). Never uses a blanket `reviewedToday` exclusion.
   - `reconcileScheduledReview(updatedItem: LearningItem, options?: { source?: ReviewSource; buryExtractId?: string | null })`:
     - Updates `useQueueStore`:
       - If `!updatedItem.is_suspended && isItemDueNow(updatedItem.due_date)`: patches matching queue entries (`id === canonicalId || learningItemId === canonicalId || id === "flashcard-" + canonicalId`) via `applyItemDeltas` with updated `dueDate` and `interval`.
       - Otherwise (future-due or suspended): removes matching flashcard queue entries via `removeItemsLocally` (matching both `id` and `learningItemId`), preserving source documents and unrelated extracts.
       - Calls `invalidateQueueGeneration()` so any in-flight queue load started before the review cannot resurrect the card.
     - Updates `useReviewStore`:
       - If `source !== "reviewStore"`, calls `useReviewStore.getState().reconcileExternalReview(updatedItem)` which removes the card if no longer due (or updates it in-place if still due), advances `currentCard` safely via `sessionTransition.ts` if it was active, and does NOT increment `reviewsCompleted` for external reviews.
     - Notifies active subscribers (e.g., mounted `QueueScrollPage` instances) via a lightweight listener registry (`subscribeReviewSync`) so `dueFlashcards` and `scrollItems` reconcile immediately without a full library reload.
   - `reconcileReviewUndo(restoredItem: LearningItem, source?: ReviewSource)`:
     - Calls `useQueueStore.getState().invalidateQueueGeneration()` (and `reconcileIfDirty` / targeted restoration) so Reading Queue reflects restored due eligibility.
     - Notifies `subscribeReviewSync` listeners so mounted `QueueScrollPage` sessions can restore due eligibility without resurrecting unrelated items.

2. **Canonical Identity in `useQueueStore`:**
   - `applyItemDelta`, `applyItemDeltas`, and `removeItemsLocally` match `QueueItem` by `item.id` OR `item.learningItemId` (and normalized `flashcard-` prefix) when matching learning items, while never matching a `document` or `extract` row by a `learningItemId` collision.

3. **Concurrent Review Protection:**
   - All scheduled flashcard review submissions (`useReviewStore.submitRating`, `QueueScrollPage.handleRating`, `DashboardTab.handleQuickRate`) acquire an exclusive token from `cardMutationCoordinator.acquireMutationToken(canonicalId, "rate")` before calling `submitReview` and release/rollback appropriately.
   - Non-scheduling practice (`reviewMode === "cram"` or `noScheduleUpdate: true`) never calls `reconcileScheduledReview`.

4. **Reconciliation with `fix-reviewer-state-and-bulk-operations`:**
   - Supersedes and generalizes BUG-05's one-way Scroll Mode -> `useQueueStore` patch into bidirectional canonical reconciliation across all scheduled review surfaces.
