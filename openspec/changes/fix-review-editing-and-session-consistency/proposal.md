## Why

Creating, editing, and managing cards must be effortless and rock-solid. Currently, typing in the Answer field of the Q&A creator modal steals focus back to the Question field after a single character (`screenshot_12`), cards in Deck Manager lose tag edits because the row omits the persistence callback (`screenshot_06`), untagged cards cannot have tags added because the edit affordance is hidden when tags are empty (`screenshot_14`), editing cards in Scroll Mode produces a "Failed to save card" toast (`orig_04`), and deleting cards in active review sessions blocks advancement or demands a review rating (`orig_09`, `orig_10`). Resolving these regressions guarantees seamless study workflow and data consistency.

## What Changes

- Eliminate focus stealing in `QACreatorPopup.tsx` by separating mount-only focus initialization from keydown event listeners.
- Restore tag persistence in `DeckManagerCardRow.tsx` by passing `onTagsPersisted` and providing an explicit "+ Add Tag" button for untagged cards.
- Fix Scroll Mode card editing in `QueueScrollPage.tsx` by binding canonical card identities and version tokens during mutations.
- Unify review session mutation state: deleting a card immediately advances the queue session and sets a tombstone preventing resurrection on background refresh.
- Standardize raw cloze delimiter editing (`{{c1::...}}`) and reveal mechanics across Review, Scroll, and Optimal modes.

## Capabilities

### New Capabilities

- `review-editing-and-session-consistency`: Stable focus management during card authoring, complete tag lifecycle integration in row views, atomic card mutation in Scroll Mode, and advance-on-delete review session transitions.

### Modified Capabilities

- `review-card-editing`: Preserve raw cloze delimiters and enable inline editing across all review surfaces.
- `review-session-mutations`: Ensure deleting a card advances the session immediately without requiring a grade.

## Impact

- **Frontend**: `src/components/extracts/QACreatorPopup.tsx`, `src/components/review/DeckManagerCardRow.tsx`, `src/components/common/CompactTagEditor.tsx`, `src/pages/QueueScrollPage.tsx`, `src/stores/reviewStore.ts`, `src/components/review/InlineCardEditor.tsx`.
- **Backend**: `src-tauri/src/commands/learning.rs`, `src-tauri/src/database/cards.rs`.
- **Invariants**: Stored card tags remain synchronized with SQLite. Card updates update SQLite atomically without altering FSRS scheduling variables or history logs.
