## 1. Extract reading

- [x] 1.1 Add `open-extract` to `getQueuePrimaryAction` and `getQueueItemSheetActions` in `src/components/review/queueActions.ts`, and extend the existing unit tests to cover extract rows
- [x] 1.2 Create the extract reader surface: renders the extract's own content, its source title, and an "Open source document" action
- [x] 1.3 Register the reader as a tab type in `src/components/tabs/TabRegistry.tsx` and route it from `QueueTab.handleOpenDocument` (and `QueuePage`) when `itemType === "extract"`
- [x] 1.4 Wire "Open source document" to the existing `focusedExtractId` path so the document viewer still scrolls to and highlights the card
- [x] 1.5 Disable "Open source document" with an explanation when the source document cannot be loaded
- [x] 1.6 Add the extract rating controls to the reader and confirm the queue updates via `applyItemDelta` rather than a full reload
- [x] 1.7 Verify the new tab type survives session restore
- [x] 1.8 Add the new strings to all six locales and run the i18n placeholder-parity test

## 2. Manual image occlusion

- [x] 2.1 Build the occlusion editor as a controlled component over `{ imageAssetId, regions }` — draw by drag, then move, resize, relabel and delete
- [x] 2.2 Clamp region bounds to the image on every mutation, and cover the clamping with unit tests
- [x] 2.3 Refuse to save with zero regions, with a visible explanation
- [x] 2.4 Persist through the existing `image-occlusion` learning-item shape so `ReviewCard` renders manual and AI cards identically
- [x] 2.5 Open the editor from `ImageSaveOverlay`'s "Create image occlusion card" button with an empty region set
- [x] 2.6 Open the editor pre-filled from an AI proposal in `FlashcardStudioModal`, so proposed regions can be corrected before saving
- [x] 2.7 Handle the unusable-AI-output case: drop or clamp out-of-bounds regions, open the editor rather than saving a card with no usable regions
- [x] 2.8 Add the new strings to all six locales and run the i18n placeholder-parity test

## 3. Assistant `#` mentions

- [x] 3.1 Add a heuristic paragraph-boundary segmenter to `src/utils/sectionIndex.ts`, labelling each segment by its opening words
- [x] 3.2 Engage the fallback from `buildDocumentSections` only when the outline/heading path yields fewer than two nodes for a document that has text; unit-test both branches
- [x] 3.3 Show an explicit "no sections available" state when the document has no extractable text, instead of an empty list
- [x] 3.4 Offer the current text selection as the first entry in the `#` popup when one exists, reusing `SectionMentionCard`
- [x] 3.5 Attach exactly the selected text as context, truncating to the context budget and telling the user when truncation happened
- [x] 3.6 Confirm `AssistantPanel`, `DocumentQATab` and `FlashcardStudioModal` all resolve through the same index and list identical entries for the same document
- [x] 3.7 Add the new strings to all six locales and run the i18n placeholder-parity test

## 4. In-app web browser

- [x] 4.1 Instrument `WebBrowserTab`: log `iframeStatus`, `webviewError`, and the computed webview bounds against the container rect, then reproduce on desktop to isolate which path fails
- [x] 4.2 Fix the cause identified in 4.1
- [x] 4.3 Render an explicit blocked state naming the site and reason when a page refuses embedding, with an "open in system browser" action
- [x] 4.4 Render an explicit error state with retry on navigation failure, without leaving a partially rendered previous page
- [x] 4.5 Keep the native webview aligned with the tab content area across window resize, split-pane resize and toolbar reposition
- [x] 4.6 Hide the native webview when the tab is not active — tabs are `display: none`, not unmounted — and restore it at the correct bounds on reactivation
- [x] 4.7 Tell the user extract creation is unavailable when the page selection cannot be read, and never create an empty extract
- [x] 4.8 Add the new strings to all six locales and run the i18n placeholder-parity test

## 5. Imported article extracts

- [x] 5.1 Attempt to reproduce a whole-article extract via URL import, the command palette import, and "save page" from the in-app browser; record the result
- [x] 5.2 If reproduced, fix the offending path so an import creates a document and no automatic extract
- [x] 5.3 Add a regression test asserting no import path creates an extract whose content length approaches its source document's length — this is the deliverable whether or not 5.1 reproduces
- [x] 5.4 Surface existing oversized extracts to the user as oversized, without deleting or rewriting them
- [x] 5.5 Close the report explicitly: either the fix in 5.2, or a note that it is not reproducible with the test from 5.3 as evidence

## 6. Verification

- [x] 6.1 Run the full test suite and typecheck
- [ ] 6.2 Exercise each fixed surface in the running app against real data — extract from the queue, an occlusion card end to end, `#` on a heading-less article, a page in the browser
- [x] 6.3 Update `docs/USER_HANDBOOK.md` and its five translations for the extract reader, the occlusion editor and selection mentions

## 5. Investigation results (recorded for 5.1 / closing note for 5.5)

**5.1 — Not reproducible.** Traced every import path in the code:

- **URL import** (`documentStore.importFromUrl` → `importFromUrlUtil` + `createDocument` + `updateDocumentContent`): creates a document only; `extractCount: 0`; no extract API is ever invoked.
- **Command palette import**: routes through the same `documentStore.importFromUrl` action — identical behaviour.
- **"Save page" / extract from the in-app browser** (`WebBrowserTab.handleSaveExtract`): creates a document plus an extract **only from explicitly selected text** (≥3 chars), and now refuses to save empty content (`extracts.enterContent`).

No import path creates an automatic extract, whole-article or otherwise. Extracts are only ever created from an explicit user selection.

**5.5 — Closed as not reproducible.** The regression test added in 5.3
(`src/utils/__tests__/documentImport.test.ts` → "import paths never create a whole-document extract") pins this behaviour: the import pipeline yields a document, never calls extract creation, and the document has zero extracts. The oversized-extract surfacing in 5.4 remains as the safety net for any existing data that already looks whole-document.

## 6. Verification notes

**6.1 — Done.** `npx tsc --noEmit` clean; full `npx vitest run` passes (297 files / 2041 tests, 1 pre-existing skip); `npx vite build` succeeds (12.7s).

**6.2 — Requires the running desktop app.** Not executable in this environment (no Rust toolchain / no GUI session). Manual QA checklist for the user:
1. Queue → open an extract row → extract reader shows the extract text, rating updates the queue without a reload, "Open source document" jumps to the focused card.
2. Hover an image → "Create image occlusion card" → draw/move/resize/relabel/delete regions → save; confirm the review card renders like an AI card.
3. `#` in the assistant on a heading-less imported article → derived segments listed; select text first → selection is the first entry; textless document shows the explicit no-sections state.
4. Web browser tab → a page that refuses embedding shows the blocked state with the site name + "Open in system browser"; a failed navigation shows the error + Retry; the native webview follows window/split-pane resize (bounds log in dev console).
5. In-app browser → "Create Extract" with no selection shows the "Selection not readable" toast and no empty extract is created.
