## 1. Confirm root cause

- [x] 1.1 Confirmed via static analysis (not live device logging): `isTabActive` is already in the hydration effect's dependency array (`DocumentViewer.tsx:2102`), so the effect does re-run once the tab becomes active — the `isTabActive` gate itself is not the failure mode. The real gap: once `hydrateDocument` resolves `null` once, `mediaError` becomes terminal — nothing ever retries, and a transient failure right after import (the doc not yet visible to a fresh `get_document` read) permanently sticks.
- [x] 1.2 Confirmed `loadDocuments()` (`documentStore.ts:197-204`, pre-fix) did an unconditional `set({ documents: docs })`, which is a real clobbering hazard: any concurrent collection-scoped call can drop an unrelated in-flight document from the shared array. Fixed regardless of whether it's the primary trigger for this specific bug.
- [x] 1.3 N/A — no temporary logging was added; findings were reached via static code reading of `DocumentViewer.tsx`, `documentStore.ts`, `tabsStore.ts`, and `AudiobooksTab.tsx`/`QueueTab.tsx`.

## 2. Fix DocumentViewer hydration

- [x] 2.1 Revised approach (see note): rather than removing the `isTabActive` gate — which static analysis showed was not the actual defect — `DocumentViewer.tsx`'s hydration effect now retries `hydrateDocument` up to 2 additional times (400ms apart) before setting the terminal "Document not found" `mediaError`, covering the transient post-import race.
- [x] 2.2 Not changed as originally scoped (adding `documents` to the dependency array risked touching a large, sensitive effect+cleanup block for uncertain benefit); the retry loop achieves the same self-healing goal without widening the effect's dependencies.
- [x] 2.3 Confirmed: `shouldLoad`/`lastLoadedDocumentIdRef` logic is untouched, so an already-successfully-loaded document is still not re-fetched.

## 3. Fix shared document list clobbering

- [x] 3.1 `loadDocuments()` in `src/stores/documentStore.ts` now merges fetched documents into the existing array by id instead of replacing it wholesale, reconciling deletions only for entries within the just-queried collection scope (or all entries when the scope is "all collections").
- [x] 3.2 `deleteDocument`/`bulkDelete` are unaffected — they mutate `documents` directly and don't go through `loadDocuments()`, so deletions still take effect immediately regardless of this merge change.

## 4. Align AudiobooksTab with QueueTab

- [x] 4.1 `AudiobooksTab.handleOpenBook` now calls `usePaneId()` and passes `paneId` to `addTab(...)`, matching `QueueTab.handleOpenDocument`.

## 5. Verify

- [ ] 5.1 On mobile: import an audiobook, immediately open it from the Audiobooks tab, confirm it plays (no "Document not found"). **Needs manual verification on a device/build — not exercised in this session.**
- [ ] 5.2 On mobile: open the Audiobooks tab directly (cold start / first tab shown) and tap an audiobook, confirming the non-active-tab-at-mount path works. **Needs manual verification.**
- [ ] 5.3 Confirm opening the same audiobook from the Queue tab still works (no regression). **Needs manual verification.**
- [ ] 5.4 Confirm opening a document with a genuinely invalid/deleted id still shows "Document not found". **Needs manual verification.**

Typecheck (`npx tsc --noEmit`) passes with no new errors introduced by this change (two pre-existing, unrelated errors remain in `nativePdfRangeTransport.ts` and `pdfCoverRender.test.ts`).
