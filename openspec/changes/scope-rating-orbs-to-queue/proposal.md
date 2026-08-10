## Why

Rating orbs (Again / Hard / Good / Easy / Dismiss) are queue-review affordances — they reschedule a document and advance to the next queue item. Today they appear in the reader whenever the open document happens to be in the queue, regardless of *where the user opened it from*. So a user browsing the Documents view who opens a document that is also in their queue is surprised by review/rating UI and, worse, a rating tap yanks them into queue navigation. The orbs should only surface when the user is actively reviewing the queue, not when they are casually reading from the library.

## What Changes

- Carry an "open origin" signal on the document-viewer tab (`data.openedFrom`) so the reader knows whether the document was opened from the **Documents** view or from the **Queue** view (or other queue-driven entry points).
- Hide the inline rating orbs inside `DocumentViewer` when the document was opened from the Documents view, even if that document is also in the queue.
- Keep rating orbs visible for documents opened from the Queue (including prev/next queue navigation and Scroll Mode), where rating + advance is the expected workflow.
- Forward the existing `hideRatingOrbs` prop through `DocumentViewerWrapper` so the tab-level signal can reach the underlying viewer, instead of being silently dropped.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `document-rating`: Adds a requirement that rating-orb visibility is gated by the origin the document was opened from (queue review vs. library browsing), so rating affordances only appear when reviewing from the queue.

## Impact

- **`src/components/viewer/DocumentViewer.tsx`**: the inline rating-orbs render condition (around line 7096) gains an origin check; the component already accepts a `hideRatingOrbs` prop.
- **`src/components/viewer/DocumentViewerWrapper.tsx`**: must declare and forward `hideRatingOrbs` (currently dropped, ~line 343) so the prop survives the tab→wrapper→viewer path.
- **`src/components/tabs/DocumentsTab.tsx`** and **`src/pages/DocumentsPage.tsx`**: the `addTab({ type: "document-viewer", data: { documentId } })` call gains `openedFrom: "documents"` (and/or sets `hideRatingOrbs: true`).
- **Queue-driven openers** (`QueueTab.tsx`, `QueuePage.tsx`, `useQueueNavigation.ts`) are unchanged or explicitly pass `openedFrom: "queue"`.
- **`src/components/queue/ScrollOverlayControls.tsx`** and the Scroll Mode path are unaffected — that overlay is queue-only and remains as-is.
- No backend, database, or FSRS changes — purely a client presentation gate.
