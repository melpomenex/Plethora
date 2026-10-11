## Why

Cloze cards in Queue Scroll Mode can show their raw `{{...}}` markup instead of hiding the answer, making the review prompt unusable. Users also need to correct or remove a card at the moment they encounter it, without leaving the queue or losing their place.

## What Changes

- Fix cloze prompt rendering so supported cloze markers are hidden before reveal and shown after reveal, including cards with missing or empty stored ranges.
- Show pencil and trash controls at the top right of a flashcard in Queue Scroll Mode. The pencil opens the existing inline editor; the trash control deletes the card through the existing undoable flow.
- Keep the active queue session coherent after a card is edited or deleted, including updating the current card or advancing after deletion.

## Capabilities

### New Capabilities
- `queue-flashcard-review-cards`: Cloze prompt/reveal rendering and in-place edit/delete actions on flashcards reviewed from the queue.

### Modified Capabilities

## Impact

- Queue Scroll Mode flashcard rendering and actions in `src/components/review/FlashcardScrollItem.tsx` and `src/pages/QueueScrollPage.tsx`.
- Existing cloze syntax normalization and parsing in `src/utils/cloze.ts`.
- Existing inline card editor and undoable learning-item deletion flows; no new dependency or storage format is expected.
