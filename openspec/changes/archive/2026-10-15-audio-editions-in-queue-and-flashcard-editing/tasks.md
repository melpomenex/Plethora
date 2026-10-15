## 1. Audio Edition Position Persistence Module & Storage

- [x] 1.1 Implement `src/utils/audioEditionPosition.ts` providing IndexedDB storage with synchronous `localStorage` fallback on unload, saving/loading `AudioEditionPosition` (`editionId`, `documentId`, `partIndex`, `timeInPart`, `globalTimeSec`, `totalDurationSec`, `updatedAt`), and verify with unit tests in `src/utils/__tests__/audioEditionPosition.test.ts`.
- [x] 1.2 Implement listening progress calculation helper (`getAudioEditionProgress`) and verify with unit tests covering 0%, mid-part (e.g. part 2 of 4), completed, and missing data cases.

## 2. Multi-Part Resume & Playback Lifecycle in AudiobookViewer

- [x] 2.1 Update `AudiobookViewer.tsx` to restore multi-part Audio Edition position (`partIndex` and `timeInPart`) when `loadEdition` resolves the ready sections playlist, verifying that `currentPartIndex` and `audioRef.current.currentTime` correctly navigate to the saved section and offset.
- [x] 2.2 Update auto-save interval, pause handler, part change handler, and unmount effect in `AudiobookViewer.tsx` to persist position to `saveAudioEditionPosition`, and verify in unit tests.
- [x] 2.3 Fix Audiobooks tab launch handlers in `AudiobooksTab.tsx`: "Listen to Audio Edition" leaves `fromSeconds` undefined (to trigger resume) while "Listen from Beginning" explicitly restarts at 0 seconds, and verify with tests in `src/components/tabs/__tests__/AudiobooksTab.test.tsx`.
- [x] 2.4 Update Audio Edition cards in `AudiobooksTab.tsx` and `DocumentsView.tsx` to display real listening progress and remaining time, and verify with component tests.

## 3. Audio Editions in Queue & Queue Consumption

- [x] 3.1 Update `CreateAudioEditionDialog.tsx` to add an "Add to Queue" toggle (enabled by default) that schedules the document for review when the edition is ready, and verify with tests.
- [x] 3.2 Add "Add to Queue" and "Remove from Queue" options to the Audio Edition context menu in `AudiobooksTab.tsx`, and verify context menu item actions.
- [x] 3.3 Update `src/types/queue.ts`, `ReviewQueueView.tsx`, and `routes/queue.tsx` to recognize items with Audio Editions, rendering an audio badge (🎧), listening progress, and audio duration.
- [x] 3.4 Wire primary queue item actions in `ReviewQueueView.tsx` and `QueueTab.tsx` to launch `DocumentViewer` with `listenToEdition: true` and resume from the saved position, and verify with tests in `src/components/review/__tests__/ReviewQueueView.test.tsx`.
- [x] 3.5 Update `QueueScrollPage.tsx` (Scroll Mode) to render the integrated Audio Edition player when an Audio Edition queue item is active, allowing continuous in-stream audio consumption and auto-advancing upon completion.

## 4. In-Queue Flashcard Editing

- [x] 4.1 Update `src/components/review/FlashcardScrollItem.tsx` to add an on-card Edit button (`review-card-edit` with pencil icon), a `Cmd+E` / `Ctrl+E` keyboard shortcut listener, and an `onEdit` callback prop, and verify in `FlashcardScrollItem.test.tsx`.
- [x] 4.2 In `src/pages/QueueScrollPage.tsx`, integrate `InlineCardEditor` modal on `onEdit` and `Cmd+E` with `surface="queue"`, patching `renderedItem.learningItem` and `scrollItems` in place on save, and verify in tests.
- [x] 4.3 In `ReviewQueueView.tsx` and `routes/queue.tsx`, add an "Edit Flashcard" action to row menus and `QueueItemActionSheet` for `learning-item` queue items, opening `InlineCardEditor` and updating the queue row in place, and verify with tests.
- [x] 4.4 Verify Studio hand-off for complex interaction types (image occlusion) from `InlineCardEditor` during in-queue editing.

## 5. End-to-End Verification & Benchmarks

- [x] 5.1 Run test suites covering position persistence, queue routing, and flashcard editing (`npm run test:run`) and verify all tests pass.
- [x] 5.2 Run performance benchmarks (`npm run bench:check`) and ensure the benchmark gate passes with no performance regressions.
