## 1. Cloze Rendering

- [x] 1.1 Update Queue Scroll Mode cloze rendering to use range data only when ranges are usable and otherwise parse normalized marker syntax; verify simplified `{{answer}}` text is masked before reveal even when ranges are empty.
- [x] 1.2 Preserve numbered markers, legacy bracket markers, and hints in the fallback path; verify markers never appear literally and reveal shows the answer in context.

## 2. Queue Card Actions

- [x] 2.1 Add accessible pencil and trash controls beside each other at the top right of Queue Scroll Mode flashcards; verify both controls are visible without covering card content or review actions.
- [x] 2.2 Wire the pencil control to the existing inline editor; verify a saved edit updates the active card without moving the user's queue position.
- [x] 2.3 Wire the trash control to the existing undoable learning-item deletion flow; verify deletion removes the active card, advances to the next queue item, and undo restores the card.

## 3. Review Flow Integration

- [x] 3.1 Verify cloze and non-cloze flashcards continue to reveal and rate correctly after the rendering and action changes, with queue progression preserved after edit or delete.
