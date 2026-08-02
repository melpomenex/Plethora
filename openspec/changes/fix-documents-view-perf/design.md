## Context

Two independent problems compound to make the Documents view lag badly with 272 documents, in order of actual impact:

**1. Sync bookkeeping re-runs in full on every tab activation (primary cause).**
[DocumentsView.tsx:285-286](src/components/documents/DocumentsView.tsx:285) calls `loadDocuments()` on an effect keyed on `isActiveTab`, so switching to the Documents tab calls it every time. `loadDocuments()` ([documentStore.ts:224](src/stores/documentStore.ts:224)) fetches the summary list, then fires `registerExistingFilesSyncLazy(docs)` — not deferred/idle-scheduled the way the boot path (`hydrateStartupDocuments`) is. `registerExistingFilesSync()` ([fileSyncRegistration.ts:145](src/lib/fileSyncRegistration.ts:145)) then does, serially, for every document:
- `manifest.getAllFiles().find(f => f.id === fileId)` — O(n) scan repeated per document → O(n²) over the manifest.
- `publishDocument(doc)` ([documentReplication.ts:151](src/lib/documentReplication.ts:151)) unconditionally, even for documents that haven't changed since the last publish. This does a Yjs `documentsMap.set(doc.id, lightweight)` write.
- Each of those 272 writes fires `documentsMap.observe()` ([documentReplication.ts:99](src/lib/documentReplication.ts:99)), which enqueues `handleRemoteDocument(key)` on the progressive sync scheduler for that key — so the app processes 272 "remote" events generated purely by its own redundant local re-publish.

This is a single long `for` loop, `await`ed serially with no chunking, so it monopolizes the main thread for as long as it takes to walk the whole library — this is what produces "lags very badly, as if it's loading all documents at once": it genuinely is redoing full sync bookkeeping for the whole library, every time.

**2. Unvirtualized list rendering (secondary, compounding cause, and only for non-default view modes).**
`DocumentsView.tsx` (~3850 lines) renders the library in several layouts. The out-of-the-box default (`compactDocumentsView` setting off, `mode` = "grid") renders `LibraryDashboard`, which is already bounded — its two horizontal sections are each capped via `.slice(0, 12)`. However, two other, commonly-used layouts render every entry of `sortedDocuments` directly with `Array.map`, uncapped:
- The legacy card-list view (`mode === "list"`, `DocumentsView.tsx:1509` prior to this change)
- The compact table view (`CompactDocumentRow`, rendered by `CompactLibraryView` when the user enables the `compactDocumentsView` setting, `DocumentsView.tsx:2620` prior to this change)

Either is easy to end up in (list mode is one click away; compact view is a settings toggle many users have on), so this is real, common-path lag, just not present in the very first default screen.

`get_documents` (backend) already returns lightweight summaries (content/metadata nulled out), confirmed in [document.rs:681](src-tauri/src/commands/document.rs:681), so this half of the problem is not an IPC/query issue either — it's client rendering. With 272 documents both layouts mount 272 full row components, each doing inline work (priority tier/reason calculation, relative-time formatting, a `useTranscriptionQueueStore.getState()` read, tag chip rendering) on every render, including renders triggered by unrelated state (e.g. opening the priority popup, toggling selection).

`@tanstack/react-virtual` (`^3.13.17`) is already a project dependency, so no new dependency is introduced for the rendering fix.

## Goals / Non-Goals

**Goals:**
- Eliminate the full serial per-document sync pass (manifest scan + unconditional publish) from running on every Documents-tab activation; only new/changed documents should do sync work after the first pass in a session.
- Preserve cross-device sync correctness: new and genuinely modified documents must still propagate to other devices without added delay.
- Bound the number of mounted document row DOM nodes to roughly viewport size regardless of library size.
- Preserve all existing interactions: click/shift-click/ctrl-click selection, long-press (mobile), context menu, keyboard shortcuts, sort/filter controls.
- Memoize the O(n) `filterCounts` scan in `CompactLibraryView` so it isn't recomputed on every render (e.g. on selection change).
- Keep both fixes client-side — no backend/IPC changes.

**Non-Goals:**
- Changing `LibraryDashboard`'s horizontally-scrolling sections (already bounded via `.slice(0, 12)`).
- Changing the `get_documents` backend command, database queries, or the Yjs/CRDT sync protocol itself.
- Introducing pagination or server-side windowing — client-side virtualization is sufficient since the full summary list is already cheap to fetch and hold in memory.
- Redesigning row visuals/content or the file-sync/manifest data model.

## Decisions

**Skip `publishDocument(doc)` when the document's clock hasn't advanced since the last publish.**
`syncClockCache` ([clockCache.ts](src/lib/sync/clockCache.ts)) already tracks the last-seen clock per entity and is used on the remote-replay path (`isStale` check in `ensureDocumentReplicationReady`'s initial replay, [documentReplication.ts:117-121](src/lib/documentReplication.ts:117)) to skip redundant local writes from remote data. The local publish path has no equivalent check — it writes unconditionally. Add a symmetric check in `publishDocument`: before calling `documentsMap.set(...)`, compare `doc.dateModified || doc.dateAdded` against the clock cache's last-published value for that doc id, and no-op if unchanged. This directly kills the 272 redundant Yjs writes (and their 272 downstream `observe()` callbacks) on every unchanged tab activation. Bias conservative: publish whenever the clock is missing, differs, or hasn't been recorded yet, so this can never suppress a real update.

**Replace the per-document `manifest.getAllFiles().find(...)` scan with a `Map` built once per sync pass.**
`registerExistingFilesSync` currently calls `manifest.getAllFiles()` (allocates a new array) and `.find(...)` (linear scan) once per document. Build a `Map<fileId, ManifestEntry>` (or `Set<fileId>`) once before the loop from a single `manifest.getAllFiles()` call, then do O(1) `.has()`/`.get()` lookups per document inside the loop.

**Gate the full existing-files sync pass to run once per session; subsequent loads only sync new/changed documents.**
Track a session-scoped "already fully registered" flag (or a set of doc ids already registered this session) alongside the existing `registerExistingFilesSyncLazy` call sites. `loadDocuments()`'s post-fetch call should diff the freshly-fetched summaries against what was registered in this session and only pass the new/changed subset to `registerExistingFilesSync`, instead of the full 272-document list every time. The existing boot-time path (`hydrateStartupDocuments` → `runDeferredSyncSetup`) still performs the first full pass; this closes the gap where `loadDocuments()` (tab activation, post-import refresh, etc.) redundantly repeats it.

**Chunk the remaining per-document loop with yields between batches.**
Even after the above, imports of many new documents at once should not block the main thread in one uninterrupted `for` loop. Process documents in small batches (e.g. 20-30 at a time) with a `requestIdleCallback`/`setTimeout(0)` yield between batches, mirroring the pattern already used for `runDeferredSyncSetup`.

**Use `@tanstack/react-virtual`'s `useVirtualizer` for both compact layouts.**
Alternative considered: `react-window`. Rejected because `@tanstack/react-virtual` is already installed and used elsewhere in the codebase (avoids adding a second virtualization library), and its hook-based API composes more naturally with the existing `useMemo`-derived `sortedDocuments` array and variable-height rows (card layout rows can wrap to different heights based on tags/badges).

**Virtualize on the outer scroll container, not `window`.**
Both layouts currently scroll within an inner `overflow-y-auto` region of the Documents view (not the document body), so `useVirtualizer` will attach to a `ref` on that existing scroll container rather than switching to window-based scrolling. This avoids restructuring the surrounding layout/header/toolbar.

**Keep selection logic operating on the full `sortedDocuments` array, not mounted rows.**
Shift-click range selection, "select all visible", etc. already read from `sortedDocuments`/`orderedDocumentIds` computed via `useMemo`, independent of what's mounted. Virtualization only changes what's rendered, not what data selection logic operates over, so range-selection correctness is preserved by construction as long as selection handlers keep referencing `sortedDocuments`/`orderedDocumentIds` rather than a "currently mounted rows" list.

**Memoize `filterCounts` with `useMemo` keyed on `documents` (and `now`'s day-bucket for the `recent` filter).**
Currently `filterCounts` in `CompactLibraryView` recomputes via `documents.filter(...)` six times on every render of that component, including renders caused only by selection changes. Wrapping it in `useMemo` keyed on `documents` removes this redundant work; the `recentCutoff` dependency on `Date.now()` is acceptable to leave uncached at the day level since it's cheap relative to the six `.filter()` passes.

**Estimate row height per layout, allow dynamic measurement.**
Table rows (`CompactDocumentRow`) are fixed height; card rows can vary due to wrapping badges/tags. Use `useVirtualizer`'s `estimateSize` with `measureElement` enabled for the card layout so variable heights don't cause overlap, and a fixed `estimateSize` for the table layout (matching the existing row's fixed height) for simplicity and slightly better scroll performance there.

## Risks / Trade-offs

- **[Risk] Clock-based publish skip could suppress a legitimate update if `dateModified` isn't bumped on some mutation path.** → Mitigation: audit document-mutation call sites to confirm `dateModified` is always advanced before `publishDocument` is invoked (most already go through `updateDocument`/similar helpers that set it); when in doubt, publish rather than skip. This is the same trust boundary the existing remote-side `isStale` check already relies on.
- **[Risk] Session-scoped "already registered" tracking could go stale if a document's file changes on disk without a corresponding `dateModified` bump (e.g. external re-encode).** → Mitigation: out of scope for this change — file-content-drift detection isn't handled by the current unconditional path either; not a regression.
- **[Risk] Virtualization breaks the "select all visible" and shift-click affordances if implemented naively against mounted DOM instead of data.** → Mitigation: keep all selection logic reading from the existing `sortedDocuments`/`orderedDocumentIds` memoized arrays (already the case), never from mounted-row refs.
- **[Risk] Dynamic row height measurement (card layout) can cause a visible layout shift/jank on first mount of new rows.** → Mitigation: seed `estimateSize` close to the typical rendered card height (measure empirically during implementation) to minimize re-measurement jumps; keep overscan modest (e.g. 6-10 rows) to pre-render just enough rows to be scrolled into without a blank frame.
- **[Risk] Existing per-row side effects (e.g. `onContextMenu`, touch long-press handlers, `useTranscriptionQueueStore.getState()` read) may behave differently once rows are recycled rather than persistently mounted.** → Mitigation: these are all stateless reads/handlers keyed off `doc`, not row-local mutable state, so recycling is safe; verify manually for audio/video transcription-status rows specifically since that's the one row-local `getState()` read.
- **[Risk] Table layout's `hidden ... lg:grid` header and grid-column alignment could desync from virtualized rows if row markup changes.** → Mitigation: keep `CompactDocumentRow`'s markup/grid-column classes unchanged; only change how it's mounted (via the virtualizer) not what it renders.

## Migration Plan

No data migration. This is a client-only change (sync-loop + rendering) gated by normal release/build. Rollback is a plain revert of the `documentStore.ts` / `fileSyncRegistration.ts` / `documentReplication.ts` / `DocumentsView.tsx` changes since no persisted state, schema, or IPC contract changes.

## Open Questions

- Should the compact table layout's virtualization also apply when `showNextAction` toggles row content height, or is that layout guaranteed fixed-height regardless? (Confirm during implementation by inspecting `CompactDocumentRow`.)
