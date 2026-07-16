## Why

The Review tab is mentally associated with flashcard-style spaced repetition — one card at a time, rate it, move on. Today it silently interleaves **reading items (documents)** into that flow, auto-revealing the "answer" and calling `rateDocument`. That breaks the user's mental model: reading is a different activity (long-form, scroll-based) that already has a dedicated home in the Optimal Queue / Queue. Mixing the two inflates the Review count, makes sessions unpredictable, and makes "Start Review" pull up documents the user never expected to see there.

## What Changes

- **Remove** the `getDueDocumentsOnly()` fetch from the review session queue builder (`reviewStore.loadQueue`), along with the document→`ReviewDocumentItem` mapping and the interleaving logic.
- The review session queue becomes flashcards / learning items **only** (`getDueItems()` → `LearningItem[]`).
- The "Start Review" flow no longer launches into an auto-revealed document card; every card is a genuine flashcard rated through the scheduler.
- Reading items remain fully reviewable where they belong — the Optimal Queue / Queue tab (`QueueTab` → `ReviewQueueView`, `reading` mode) — which is unchanged.
- Empty-state behavior preserved: if a user has zero due flashcards, the session stays empty / shows the no-due-cards state, rather than padding with documents.
- No backend changes are required — `get_due_items` already returns only learning items; the change is entirely in the frontend store and downstream UI.
- `ReviewDocumentItem` type and `ReviewDocumentCard` component become dead code and are removed for cleanliness.

## Capabilities

### New Capabilities
- `flashcard-review-session`: defines what the Review tab's session queue contains and how items are loaded — specifically that it is scoped to flashcards / learning items only, excluding reading items (documents).

### Modified Capabilities
<!-- None — no existing spec covers the review session queue, so there is no delta to apply. -->

## Impact

- **Frontend store**: `src/stores/reviewStore.ts` — `loadQueue()` rewritten to drop the documents stream and interleaving; `submitRating` loses its document branch; session-state init drops the `isFirstDocument` logic.
- **Frontend types**: `src/stores/reviewStore.ts` — `ReviewDocumentItem` and `ReviewSessionItem` union narrowed to `LearningItem` (or removed).
- **Frontend components**: `src/components/review/ReviewSession.tsx` and `src/components/review/ReviewDocumentCard.tsx` — remove document-card rendering branch; `ReviewDocumentCard.tsx` deleted.
- **Frontend imports**: `getDueDocumentsOnly` import dropped from `reviewStore.ts`; verify no other call sites.
- **Backend**: No changes. `get_due_documents_only` / `get_due_items` commands remain as-is (the former is still used by the Queue's `due-today` reading mode).
- **No data migration**: nothing stored changes shape; in-flight stored sessions referencing document ids simply become no-ops (those ids won't match pending flashcards).
- **No breaking API change** — purely a frontend UX correction.
