## Why

Rating orbs (Again / Hard / Good / Easy / Dismiss) are intended exclusively for Queue review sessions. Currently, if a document is present anywhere in the user's queue, the rating orbs are displayed in standalone reader tabs whenever `openedFrom !== "documents"`, causing orbs to appear on documents opened from search, recent items, continue reading, restored tabs, or direct links. Clicking these orbs outside a queue session does nothing useful (or fails silently without advancing), cluttering the reader and confusing the user.

## What Changes

- Gate the inline rating orbs in `DocumentViewer` so they are ONLY shown when the document was explicitly opened from the Queue (`openedFrom === "queue"`).
- Invert the visibility gate from a blacklist (`openedFrom !== "documents"`) to an explicit whitelist requirement (`openedFrom === "queue"`).
- Ensure rating keyboard shortcuts (keys 1-4) in `DocumentViewer` are only active when reviewing from the Queue (`openedFrom === "queue"`), avoiding accidental rating submissions during standalone reading.
- Ensure that standalone reading entry points (Continue Reading, Recents, Search, Toolbar, Bookmarks, Direct links) never display rating orbs even if the underlying document is scheduled in the queue.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `document-rating`: Restrict inline rating orbs and rating keyboard shortcuts so they only appear and operate when the document is being actively reviewed from the queue (`openedFrom === "queue"`). When not in Queue, the rating orbs must be hidden and rating shortcuts disabled.

## Impact

- `src/components/viewer/DocumentViewer.tsx`:
  - Update `shouldHideRatingOrbs` to hide rating orbs whenever `openedFrom !== "queue"` or `hideRatingOrbs` is true.
  - Update rating shortcut condition (keys 1-4) to only listen when `openedFrom === "queue"`.
- `src/components/viewer/DocumentViewerWrapper.tsx`:
  - Verify prop forwarding of `openedFrom` and `hideRatingOrbs`.
- Automated tests:
  - Add or update unit tests covering rating orb visibility and keyboard shortcut behavior based on `openedFrom`.
- No database migrations, API changes, or backend impact.
