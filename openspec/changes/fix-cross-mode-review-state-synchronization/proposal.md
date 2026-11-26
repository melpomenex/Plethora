# Change: Fix Cross-Mode Review State Synchronization

## Why

Completing a scheduled flashcard review in Review View does not remove or update that card in Scroll Mode (`QueueScrollPage`) or Reading Queue (`useQueueStore`), and completing a card in Scroll Mode or Quick Review (`DashboardTab`) does not reconcile `useReviewStore` or other mounted review surfaces. Additionally:
- `useQueueStore.removeItemsLocally` and `applyItemDelta` only match `item.id`, missing queue rows where `item.learningItemId === canonicalId` (e.g., `id: "flashcard-..."`).
- `useReviewStore.undoLastReview` restores only `useReviewStore` state without restoring eligibility in `useQueueStore` or Scroll Mode.
- `DashboardTab.handleQuickRate` calls `submitReview` directly without `cardMutationCoordinator` locking or cross-store reconciliation.
- `QueueScrollPage` caches `dueFlashcards` on mount without reconciling external reviews or guarding against stale `getDueItems` responses.

This change extends and reconciles **BUG-05** in `fix-reviewer-state-and-bulk-operations` into a canonical bidirectional cross-mode review synchronization architecture.

## What Changes

- **Shared Review State Reconciliation (`src/lib/reviewSync.ts`):** Introduce a canonical reconciliation coordinator (`reconcileScheduledReviewOutcome`, `reconcileReviewUndoOutcome`, and subscription hooks) invoked after every committed scheduled review (`noScheduleUpdate !== true`) and review undo.
- **Canonical Identity & Due-Eligibility Reconciliation (`useQueueStore`, `useReviewStore`, `QueueScrollPage`):**
  - Match queue items by both `item.id` and `item.learningItemId` (normalizing `flashcard-` prefixes) without removing unrelated documents, extracts, or sibling cards.
  - Determine due-only eligibility from authoritative `updatedItem.due_date` (using `<= now` / active queue window, never a permanent `reviewedToday` ban) so `Again` / short-interval relearning cards remain eligible while future-due cards leave due-only queues.
  - Reconcile `useReviewStore` when cards are reviewed externally (Scroll Mode, Quick Review) and preserve session statistics and unaffected cards.
  - Reconcile `QueueScrollPage` (`dueFlashcards`, `scrollItems`, `ratedFlashcardIds`) when cards are reviewed or undone externally, and guard `getDueItems` against stale responses.
  - Consolidate `DashboardTab.handleQuickRate` through `cardMutationCoordinator` and canonical reconciliation.
- **Comprehensive Regression Tests:** Cover Review View <-> Scroll Mode <-> Reading Queue <-> Quick Review, scheduling states (`Again`/short relearning vs future-due), race conditions, failure/rollback, canonical identity, and negative cases (preview/skip/non-scheduling practice).

## Scope & Non-Goals

- **In scope:** Frontend review mutation reconciliation across Review View, Zen Review, Scroll Mode, Reading Queue, Quick Review, and Review Undo; `useQueueStore` canonical identity matching; stale-response guards; regression tests.
- **Non-goals:** Altering FSRS/Precision/SM-2/SM-18 scheduling math or redesigning cross-device Yjs sync.
