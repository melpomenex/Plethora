## 1. Gate Rating Orbs and Shortcuts in DocumentViewer

- [x] 1.1 In `src/components/viewer/DocumentViewer.tsx`, update `shouldHideRatingOrbs` to require `openedFrom === "queue"` (`hideRatingOrbs || openedFrom !== "queue"`).
- [x] 1.2 In `src/components/viewer/DocumentViewer.tsx`, update keyboard rating shortcut handlers (keys 1-4) so they only trigger when `!shouldHideRatingOrbs` and `openedFrom === "queue"`.

## 2. Verify Caller Wiring

- [x] 2.1 Verify `src/components/viewer/DocumentViewerWrapper.tsx` forwards `openedFrom` and `hideRatingOrbs` faithfully to `DocumentViewer`.
- [x] 2.2 Verify queue entry points (`QueueTab.tsx`, `QueuePage.tsx`, `useQueueNavigation.ts`) pass `openedFrom: "queue"`.

## 3. Automated Tests and Verification

- [x] 3.1 Add unit tests verifying that rating orbs are hidden when `openedFrom` is undefined or not `"queue"`, even when the document is scheduled in the queue.
- [x] 3.2 Add unit tests verifying that rating orbs are displayed when `openedFrom === "queue"` (and `hideRatingOrbs` is not true).
- [x] 3.3 Verify test suite and benchmark gate pass (`npm run bench:check`).
