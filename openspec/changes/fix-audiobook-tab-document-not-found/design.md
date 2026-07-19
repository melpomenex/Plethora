## Context

`DocumentViewer` resolves the document to render with:

```ts
const localDocument = documents.find((d) => d.id === documentId);
const currentDocument =
  localDocument || (globalCurrentDocument?.id === documentId ? globalCurrentDocument : undefined);
```

If `currentDocument` is `undefined`, the component renders "Document not found" as soon as `documentId` is set (`src/components/viewer/DocumentViewer.tsx:5106-5111`). The only way to populate `currentDocument` for a freshly opened tab is the hydration effect at `DocumentViewer.tsx:2004-2045`, which calls `hydrateDocument(documentId)` → `documentsApi.getDocument(id)` and, on success, `setCurrentDocument(fetched)`.

That effect returns immediately, doing nothing, when `!isTabActive`. Both `AudiobooksTab.handleOpenBook` and `QueueTab.handleOpenDocument` call `addTab(...)` to open a new `document-viewer` tab, but `AudiobooksTab` omits the `paneId` argument that `QueueTab` passes. Depending on how `addTab`'s pane-targeting fallback interacts with which pane/tab is considered "active" immediately after creation, a tab opened without an explicit `paneId` can end up mounted but not (yet) marked active — which prevents hydration from ever running, and there is no re-trigger once the tab becomes active later, nor any retry once `mediaError` is set. The result is a permanently stuck "Document not found" screen.

Separately, `loadDocuments()` (`src/stores/documentStore.ts:197-204`) does an unscoped `set({ documents: docs })` using whatever `activeCollectionId` happens to be active at call time. Because `documents` is a single shared array read by every tab, any other consumer calling `loadDocuments()` (or `loadDocumentsPage()`) with a different collection scope around the same time can overwrite the array and drop an audiobook that was visible a moment ago, right as `DocumentViewer` mounts and does its synchronous `documents.find(...)` lookup.

## Goals / Non-Goals

**Goals:**
- Opening a document from the Audiobooks tab is exactly as reliable as opening it from the Queue tab.
- `DocumentViewer` never gets stuck showing "Document not found" for a document that genuinely exists, regardless of tab-activation timing or transient store races.
- Bring `AudiobooksTab`'s tab-opening call in line with `QueueTab`'s so future tabs/panes behave consistently.

**Non-Goals:**
- Rearchitecting the tab/pane system or the document store's caching strategy beyond what's needed to fix this bug.
- Changing the Rust `get_document`/`get_documents` backend commands (both were verified to query the same table/id consistently).
- Addressing unrelated audiobook features (multi-part playback, chapters, etc.).

## Decisions

- **Hydrate regardless of `isTabActive`, gate only on `documentId` presence.** The `isTabActive` short-circuit was presumably intended to avoid wasted background fetches, but it has the side effect of permanently starving hydration if the tab isn't active at mount time and nothing re-triggers the effect later. Alternative considered: keep the gate but add `isTabActive` to the effect's dependency array so it re-runs when the tab becomes active. Rejected as the primary fix because it still leaves a window where a document that *is* available is shown as "not found" while inactive, and adds a second implicit precondition to a data-loading path — simpler and more robust to always attempt hydration when we have a `documentId` and haven't successfully loaded it yet.
- **Make the "not found" state recoverable.** After a failed `hydrateDocument`, retry when `documentId`, the `documents` array, or `isTabActive` changes, instead of leaving `mediaError` as a terminal flag. This covers the store-clobbering race even if the clobbering itself isn't fully eliminated.
- **Scope `loadDocuments()` writes so concurrent calls don't clobber each other.** Simplest fix: merge/update matching entries into the existing `documents` array rather than replacing it wholesale, mirroring the merge behavior already used in `hydrateDocument` (`documentStore.ts:228-241`). Alternative considered: give each tab its own local document list instead of relying on the shared store; rejected as a much larger refactor for a bug-fix change.
- **Pass `paneId` from `AudiobooksTab.handleOpenBook`.** Matches `QueueTab` exactly, removing an unexplained divergence that is plausibly part of the activation-timing issue and is a one-line, zero-risk fix regardless.

## Risks / Trade-offs

- [Always attempting hydration on mount could increase redundant network/DB calls for inactive tabs] → Mitigated by the existing `shouldLoad` check (`documentId !== lastLoadedDocumentIdRef.current`), which already prevents re-fetching a document that loaded successfully.
- [Merging into `documents` instead of replacing could leave stale entries around after a document is deleted elsewhere] → Deletion already goes through `deleteDocument`/`bulkDelete`, which explicitly remove entries; `loadDocuments()`'s merge only needs to reconcile additions/updates from the fetched, collection-scoped set, not perform deletions.
- [Retrying hydration after failure could mask a genuine "document was deleted" case by looping] → Cap retries to state transitions (`documentId`/`documents`/`isTabActive` change), not a timer loop, so a truly deleted document still settles on "Document not found" once inputs stop changing.

## Migration Plan

No data migration. Roll out as a normal code change; verify manually on mobile by importing an audiobook and opening it from the Audiobooks tab immediately after import, and from a cold app start with the Audiobooks tab opened directly (non-active-tab case).

## Open Questions

- None blocking; the exact interaction between `addTab`'s pane-targeting fallback and `isTabActive` should be confirmed while implementing, but the fix (always attempt hydration once `documentId` is known, regardless of activation state) is correct either way.
