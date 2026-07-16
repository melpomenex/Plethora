# Tasks

## 1. Review store — remove document stream from the queue

- [x] 1.1 In `src/stores/reviewStore.ts`, drop the `getDueDocumentsOnly` import (line 15) and the `rateDocument` / `restoreDocumentScheduling` imports from `../api/algorithm` (line 16) if no longer referenced after the rest of this section.
- [x] 1.2 Rewrite `loadQueue()` (lines 215-330): remove the `getDueDocumentsOnly()` fetch from the `Promise.all`, remove the `documentItems` mapping (221-231) and the `collectionFilteredDocuments` / `deckFilteredDocuments` / `pendingDocuments` / `sortedDocuments` variables. The queue becomes the sorted `LearningItem[]` (`pendingCards` → `sortedCards`). Remove the interleave loop (267-286) and set `queue` directly to `sortedCards`.
- [x] 1.3 In `loadQueue()`, remove the `isFirstDocument` computation (290) and set `isAnswerShown: false` unconditionally in the resulting `set(...)` (currently 302). Drop the `!isFirstDocument` guard around `loadPreviewIntervals()` (321) so it always runs when the queue is non-empty.
- [x] 1.4 In `submitRating()` (around 400, 477-479): remove the `currentCard as ReviewDocumentItem` document branch and the `rateDocument(...)` call. All ratings route to `submitReview`.
- [x] 1.5 Remove the document early-return in `loadPreviewIntervals()` (line 524: `if ((currentCard as ReviewDocumentItem).itemType === "document") return;`).
- [x] 1.6 Simplify all remaining document-keyed state transitions: remove `nextIsDocument` checks and their ternary `isAnswerShown` assignments in the advance/skip/undo flows (around 373-380, 392, 449-454, 555-559, 589-593, 639-643). Set `isAnswerShown: false` directly.
- [x] 1.7 In `getCurrentState()`/snapshot builders (around 392), drop the `currentLearningItem` document-vs-learning branching so it captures the current `LearningItem` directly.

## 2. Review store — narrow the type union

- [x] 2.1 Delete the `ReviewDocumentItem` type (lines 59-71).
- [x] 2.2 Replace `export type ReviewSessionItem = LearningItem | ReviewDocumentItem;` (line 71) with `export type ReviewSessionItem = LearningItem;` (or re-export `LearningItem` if that reads cleaner). Update any internal uses of `ReviewSessionItem[]` to `LearningItem[]` where it simplifies.

## 3. Review session UI — remove document rendering

- [x] 3.1 Delete `src/components/review/ReviewDocumentCard.tsx`.
- [x] 3.2 In `src/components/review/ReviewSession.tsx`: remove the `ReviewDocumentItem` / `ReviewDocumentCard` imports (lines 10, 12); remove the `isDocumentItem` helper (181-182); remove the `<ReviewDocumentCard>` render branch (line 783) and replace the `Exclude<ReviewSessionItem, ReviewDocumentItem>` casts (800, 830, 844) with direct `LearningItem` typing of `currentCard`.
- [x] 3.3 In `src/components/review/ZenReviewMode.tsx`: remove the `isDocument` derivation (line 51) and any branch keyed on it.

## 4. Review route — drop now-dead document guards

- [x] 4.1 In `src/routes/review.tsx`: remove the `card.itemType === "document"` early-returns in the preview-interval / metadata selectors (lines 104, 118, 129, 142, 197). With documents gone from the session these are unreachable; collapse each selector to its flashcard path.

## 5. Tests

- [x] 5.1 Update `src/stores/__tests__/reviewStore.test.ts`: remove the `getDueDocumentsOnly` mock (line 31) and any document test fixture (line 151). Add/adjust a test asserting that when both due flashcards and due documents exist, `loadQueue()` produces a queue containing only the flashcards (mock `getDueItems` to return flashcards and `getDueDocumentsOnly` to return documents; assert no document items appear and no `rateDocument` call is made on rating).
- [x] 5.2 Add a test asserting the empty-flashcards case yields an empty queue even when documents are due (no padding).
- [x] 5.3 Remove any test that exercised `ReviewDocumentCard` rendering or the document branch of `submitRating`.

## 6. Verification

- [x] 6.1 Run `npm run typecheck` (or project equivalent) — the narrowed union must surface any missed document branch as a compile error. Fix all reported sites.
- [x] 6.2 Run the review-store and review-session test suites (`npm test -- reviewStore ReviewSession`) and ensure green.
- [x] 6.3 Build the app (`npm run build` or `npm run tauri build` for desktop) and confirm no references to the deleted `ReviewDocumentCard` / `ReviewDocumentItem` remain.
- [ ] 6.4 Manual: with due flashcards and due documents present, start a Review session and confirm only flashcards appear; confirm the Queue tab's reading mode still shows the due documents unchanged.
