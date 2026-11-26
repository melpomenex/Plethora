## 1. Canonical Review Reconciliation Infrastructure
- [x] 1.1 Create `src/lib/reviewSync.ts` with `isItemDueNow`, `canonicalLearningItemId`, `reconcileScheduledReview`, `reconcileReviewUndo`, and `subscribeReviewSync`.
- [x] 1.2 Update `src/stores/queueStore.ts` (`applyItemDelta`, `applyItemDeltas`, `removeItemsLocally`) to match flashcard `QueueItem` rows by both `id` and `learningItemId` (preserving documents and extracts).

## 2. Integrate All Review Submission & Undo Paths
- [x] 2.1 Update `src/stores/reviewStore.ts` to call `reconcileScheduledReview` on normal scheduled `submitRating` commits, `reconcileReviewUndo` on `undoLastReview`, and add `reconcileExternalReview` for reviews committed from other surfaces.
- [x] 2.2 Update `src/pages/QueueScrollPage.tsx` to route flashcard review commits through `reconcileScheduledReview`, subscribe to `subscribeReviewSync` to reconcile `dueFlashcards` and `scrollItems` on external reviews/undos, and guard `getDueItems` against stale responses.
- [x] 2.3 Update `src/components/tabs/DashboardTab.tsx` (`handleQuickRate`) to acquire `cardMutationCoordinator` token and call `reconcileScheduledReview` on commit.
- [x] 2.4 Audit `ZenReviewMode.tsx`, `QuickReviewWidget.tsx`, `ReviewSession.tsx`, and `useAudioReviewMode.ts` to confirm all scheduled review paths go through canonical reconciliation and non-scheduling modes do not.

## 3. Comprehensive Regression Tests & Verification
- [x] 3.1 Add `src/lib/__tests__/reviewSync.test.ts` covering cross-mode sync (Review View <-> Scroll Mode <-> Reading Queue <-> Quick Review), due eligibility (`Again`/relearning vs future-due), race conditions, failure/rollback, canonical identity, and negative cases.
- [x] 3.2 Add/update store and component tests in `src/stores/__tests__/reviewStore.test.ts`, `src/stores/__tests__/queueStore.test.ts`, and `src/components/review/__tests__/DashboardQuickReview.test.tsx`.
- [x] 3.3 Run Vitest, TypeScript (`tsc`), and OpenSpec validation.
