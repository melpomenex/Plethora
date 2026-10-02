## Why

Plethora provides rich multimodal study features including AI-generated Audio Editions, a continuous Queue (both list-based and TikTok-style vertical Scroll Mode), and spaced repetition flashcard review. However, three critical user experience gaps disrupt the seamless study workflow:

1. **Lost Audio Edition Playback Position**: When users listen to an Audio Edition spanning multiple semantic sections/parts (e.g., halfway through Part 2) and stop, their position is lost. Reopening the edition jumps back to the beginning of Part 1 (or 0 seconds) due to asynchronous playlist initialization races, lack of dedicated section/part position persistence, and default `fromSeconds = 0` parameters.
2. **Audio Editions Absent From Queue**: Audio Editions currently live in isolation on the Audiobooks tab. Users cannot enqueue Audio Editions into their reading/study queue, nor can they consume Audio Editions seamlessly alongside documents, extracts, and flashcards within Queue Scroll Mode.
3. **Inability to Edit Flashcards While in Queue**: When users review their Queue (especially in Queue Scroll Mode where flashcards appear interleaved with documents and articles), they cannot immediately fix typos, clarify wording, adjust cloze deletions, or edit tags on cards they encounter. In the dedicated Review section (`ReviewSession`), cards feature an inline editor (`InlineCardEditor`) triggered by an on-card button and `Cmd/Ctrl+E`. In Queue surfaces, no such edit capability exists, forcing users to leave their queue session, find the card in Decks or Studio, and lose their place.

Closing these three gaps allows users to resume audio editions right where they left off, seamlessly integrate Audio Editions into their daily study queue, and edit flashcards the instant they notice an error while reviewing their queue.

## What Changes

- **Audio Edition Position Persistence & Multi-Part Resume**:
  - Implement durable Audio Edition playback position tracking (`editionId`, `documentId`, `partIndex`, `timeInPart`, `globalTimeSec`, `totalDurationSec`, `updatedAt`) stored via IndexedDB and synchronized with localStorage and backend position APIs.
  - Fix mount and initialization lifecycle in `AudiobookViewer` so that multi-part editions accurately restore the saved `partIndex` and seek to `timeInPart` once the edition manifest and playlist are resolved.
  - Fix Audiobooks tab launch handlers so "Listen to Audio Edition" resumes from the saved position, while "Listen from Beginning" explicitly restarts at 0 seconds.
  - Automatically persist listening position periodically during playback (5s interval), on pause, on section/chapter change, and on component unmount / tab close.
  - Display actual listening progress percentage and remaining duration on Audio Edition cards in the Audiobooks tab, Documents view, and Queue.

- **Audio Editions in Queue & In-Queue Consumption**:
  - Add an "Add to Queue" option in `CreateAudioEditionDialog` (defaulting to enabled) and context menus across Audiobooks and Documents views.
  - Extend queue item categorization to recognize and highlight Audio Editions (headphones badge, audio duration, listening progress).
  - Update `ReviewQueueView` and `routes/queue.tsx` so the primary action on Audio Edition items is "Listen to Audio Edition", launching playback with `listenToEdition: true` and resuming from the saved position.
  - Integrate Audio Edition playback directly into `QueueScrollPage` (Scroll Mode), allowing Audio Editions to be consumed in-stream with complete playback controls, chapter navigation, audio extract creation, and auto-advance upon completion.

- **In-Queue Flashcard Editing**:
  - Add an on-card Edit button (pencil icon matching `ReviewCard`'s `review-card-edit`) and `Cmd+E` / `Ctrl+E` keyboard shortcut to `FlashcardScrollItem` in `QueueScrollPage`.
  - Wire `InlineCardEditor` modal into `QueueScrollPage` with `surface="queue"`, allowing in-place edits to question, answer, cloze deletion text, and tags.
  - Patch the updated card in place within the active scroll session (`scrollItems` and `renderedItem.learningItem`) without reloading or losing the user's scroll position.
  - Add "Edit Flashcard" action to `ReviewQueueView` and `routes/queue.tsx` context menus and action sheets for `learning-item` queue rows.
  - Support "Edit in Studio" hand-off for complex card interaction types (such as image occlusion), matching the `ReviewSession` pattern.

## Capabilities

### New Capabilities
- `audio-edition-position-persistence`: Exact multi-part position tracking (`partIndex` + `timeInPart`), seamless resume across app sessions, throttled save lifecycle, and listening progress calculation for Audio Editions.
- `audio-editions-in-queue`: Enqueueing Audio Editions into the user's Queue, presenting them with audio-specific metadata and progress, and consuming them directly in Queue list view and Queue Scroll Mode.
- `queue-inline-flashcard-editing`: Interactive editing of flashcards directly within Queue surfaces (`QueueScrollPage` scroll review and `ReviewQueueView` queue listings) using `InlineCardEditor` without interrupting the review session.

### Modified Capabilities
- `queue-item-type-routing`: Update queue item routing and presentation rules to support audio edition items and in-stream flashcard editing during Queue scroll sessions.

## Impact

- **Frontend Components**:
  - `src/components/viewer/AudiobookViewer.tsx`: Position restoration after multi-part edition load, auto-save hook, resume vs. restart logic.
  - `src/components/tabs/AudiobooksTab.tsx`: "Listen to Audio Edition" resume behavior, "Add to Queue" context menu action, listening progress display.
  - `src/components/audio/CreateAudioEditionDialog.tsx`: "Add to Queue" option upon edition creation.
  - `src/pages/QueueScrollPage.tsx`: In-stream Audio Edition player rendering and `InlineCardEditor` modal integration with keyboard shortcut.
  - `src/components/review/FlashcardScrollItem.tsx`: Edit button (pencil icon), `Cmd/Ctrl+E` listener, and `onEdit` callback prop.
  - `src/components/review/ReviewQueueView.tsx`: Audio Edition queue row badge/actions, "Edit Flashcard" context menu/action sheet handler.
  - `src/routes/queue.tsx`: Audio Edition primary actions and flashcard edit modal integration.
- **Storage & APIs**:
  - New `src/utils/audioEditionPosition.ts`: IndexedDB and localStorage storage manager for Audio Edition playback positions.
  - `src/types/queue.ts`: Queue item metadata for Audio Editions.
- **Dependencies**: No new external dependencies required; reuses existing Phosphor icons, IndexedDB, and `InlineCardEditor`.
