## Why

Tapping an audiobook in the mobile **Audiobooks** tab opens a viewer tab that immediately shows "Document not found," even though the same audiobook (same `documents.id`) plays correctly when opened from the **Queue** tab. This makes the Audiobooks tab unusable for its primary purpose — resuming playback of an imported audiobook — right after import.

## What Changes

- Fix `DocumentViewer`'s document-hydration effect so it does not skip loading when the newly opened tab is not yet the active tab (`isTabActive` gate at `src/components/viewer/DocumentViewer.tsx:2004-2006`), and so it re-attempts hydration once the tab does become active instead of leaving `currentDocument` permanently unresolved.
- Fix `DocumentViewer`'s "not found" state so a failed/skipped hydration attempt is recoverable (retried when the tab becomes active or the document later appears in the store) instead of being a terminal, un-retryable state once `mediaError` is set (`src/components/viewer/DocumentViewer.tsx:2026-2044`).
- Stop `loadDocuments()` (`src/stores/documentStore.ts:197-204`) from unconditionally replacing the shared `documents` array with a collection-scoped fetch — concurrent calls from different tabs (e.g. Audiobooks tab vs. whichever tab last set `activeCollectionId`) can clobber each other and drop an audiobook that was just visible in the list out of the store before its viewer tab mounts.
- Align `AudiobooksTab.handleOpenBook` (`src/components/tabs/AudiobooksTab.tsx:145-154`) with `QueueTab.handleOpenDocument` (`src/components/tabs/QueueTab.tsx:29-38`) by passing the same `paneId` argument to `addTab(...)`, removing the unexplained inconsistency between the two call sites.

## Capabilities

### New Capabilities
- `audiobook-library-navigation`: Opening an audiobook from the Audiobooks tab reliably opens that same document in the viewer, matching the reliability already guaranteed when opening a document from the Queue tab.

### Modified Capabilities
(none — no existing spec currently covers this behavior)

## Impact

- `src/components/viewer/DocumentViewer.tsx` — hydration effect and not-found rendering logic.
- `src/stores/documentStore.ts` — `loadDocuments()` mutation of shared state.
- `src/components/tabs/AudiobooksTab.tsx` — tap-to-open handler.
- `src/components/tabs/QueueTab.tsx` — reference behavior (no change expected, used for parity).
- Affects mobile users opening audiobooks from the Audiobooks tab immediately after import; does not affect desktop or Queue-based navigation, which already works.
