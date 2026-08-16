## 1. Desktop PDF context menu

- [x] 1.1 Add `onContextMenu?: (payload: {x, y, selectedText, selectionContext}) => void` prop to `PDFViewer` (kept in a ref like EPUBViewer's) covering native, reflow, and OCR-HTML view modes
- [x] 1.2 In `PDFViewer`'s selection-commit effect (~`PDFViewer.tsx:2644-2758`), register a top-level-document `contextmenu` listener: when a committed valid selection exists (fixed: `persistedSelection` + `selectionAnchorsInTextLayers`; reflow: committed reflow `PdfSelectionContext`), `preventDefault()` and emit pointer coords plus the committed context; with no selection, let the default menu through
- [x] 1.3 Wire `onContextMenu` on the `PDFViewer` render in `DocumentViewer.tsx` (~6890) to `setContextMenuState({visible: true, x, y, selectedText, selectionContext})`
- [x] 1.4 Relax the render gate at `DocumentViewer.tsx:7801` from `docType !== "pdf"` so PDFs (all view modes, including OCR-HTML's existing iframe listener) render the shared `ContextMenu`
- [x] 1.5 Hide the floating `SelectionPopup` while `contextMenuState` is open (supersedes rule); restore on close if the selection is still committed
- [x] 1.6 Verify `buildContextMenuItems` produces working actions for a `PdfSelectionContext` (extract payload passes `buildPdfSelectionExtractPayload`, highlight colors route to `createInstantExtract`, AI rows open `SelectionActionsSheet` with `initialAction`); fix any PDF-specific gaps found
- [x] 1.7 Add/extend vitest coverage: contextmenu emission with and without a selection, gate no longer excludes PDF, popup hidden while menu open (extend the viewer test suite, e.g. `src/components/viewer/__tests__/`)

## 2. Mobile PDF toolbar spacing

- [x] 2.1 Add a shared utility class (e.g. `.safe-x-pad`) in `src/index.css` next to the existing `.safe-*` helpers: `padding-left/right: max(env(safe-area-inset-left/right, 0px), 12px)`
- [x] 2.2 Apply it to the PDF reader toolbar on phones (`PDFViewer.css` mobile media block / `PDFViewer.tsx:3926` toolbar), overriding the `p-1` horizontal padding only
- [x] 2.3 Apply the same clearance to DocumentViewer's mobile compact toolbar (`DocumentViewer.tsx:5910`) in place of its horizontal `p-2`
- [x] 2.4 Confirm the auto-hide translate, 44px touch targets, and gear popover anchoring still work; spot-check at 360dp width and landscape with simulated insets (visual harness or Playwright)

## 3. Touch selection dismissal (reflowed PDF)

- [x] 3.1 In `DocumentViewer`'s mobile selection monitor effect (~3562-3712), add a capture-phase `scroll` listener on the `data-document-content` wrapper; on scroll beyond a ~8px threshold, close the sheet, clear `mobileSelection`, and record the dismissal — never touching the native selection
- [x] 3.2 Replace the offset-keyed 2500ms dismissal guard with text-equality suppression (no expiry): a stability-gated selection whose text equals the dismissed text stays suppressed
- [x] 3.3 Clear suppression when the native selection collapses (existing `hideSelectionUi` path) and on fresh `touchstart`/`mousedown` inside the content wrapper, so deliberate re-selection re-opens the sheet
- [x] 3.4 Keep scrim tap / Escape dismissal working and recording the same suppression
- [x] 3.5 Add/extend vitest coverage: scroll dismisses past threshold but not below it; reflow DOM churn (appended sections around a live selection) does not re-open the sheet; fresh gesture + same text re-opens it

## 4. View first-load reliability

- [x] 4.1 `DocumentsView.tsx`: include `activeCollectionId` (and a derived load key) in the load effect deps so first-mount-with-placeholder reloads after hydration and collection switches reload while active
- [x] 4.2 Confirm `documentStore.loadDocuments` stale-discard semantics stay correct with re-triggering (no double-apply flicker); adjust if needed
- [x] 4.3 `ReviewQueueView.tsx`: move `setLoadedQueryKey(loadKey)` to after a load path completes successfully; keep `dedupeLoad` coalescing for rapid re-entries
- [x] 4.4 Add the mobile view's retry-with-backoff to the desktop queue view when `ensureStartup` resolves null (watchdog case)
- [x] 4.5 `lib/tauri.ts`: clear the cached `backendReadyPromise` when the readiness probe exhausts its attempts so later invokes re-probe
- [x] 4.6 Add/extend vitest coverage: Documents reload when `activeCollectionId` hydrates after mount; queue view retries after watchdog-null and doesn't early-return on a claimed key; readiness re-probe succeeds after a failed cycle (mirror `MobileQueueView.startup.test.tsx` / `startupStore.stall.test.ts` patterns)

## 5. Verification

- [x] 5.1 Run `npx tsc --noEmit` (or the repo's typecheck script) and `npm run lint`, fix findings
- [x] 5.2 Run the relevant vitest suites (viewer, stores, documents, review) and the full unit test command used by CI
- [x] 5.3 Run `npm run bench:check`; if any intentional baseline movement occurs, update `scripts/perf-baselines.json` per the AGENTS.md protocol
- [ ] 5.4 Manual smoke on desktop (macOS) build: (browser-mode first-load of the default Queue view verified on the dev server; native macOS right-click and Android touch/toolbar checks still pending — require real builds) PDF right-click menu in native + reflow modes, all actions fire; and on Android build: toolbar edges in portrait/landscape, reflow selection dismiss-on-scroll, first visit to Queue and Documents loads without cycling
