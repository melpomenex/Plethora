## 1. Selection action registry (behavior-preserving extraction)

- [x] 1.1 Create `src/components/viewer/selectionInteraction/selectionActionRegistry.ts` with the typed `SelectionActionDescriptor` union, per-surface availability rules, and `getActionsFor(context, surface)`; verify a new unit test file covers availability gating per surface and selection properties
- [x] 1.2 Rewire `SelectionActionBar.tsx` and `SelectionActionsSheet.tsx` to derive their items and dispatch from the registry (same actions, order, and feature-flag gating as today); verify by updating the existing bar/sheet tests to assert the registry-derived sets
- [x] 1.3 Rewire `buildContextMenuItems` in `DocumentViewer.tsx` to derive desktop menu items from the same registry via one `actionId → handler` map; verify the desktop menu test asserts identical items before/after for epub, pdf, and html selections
- [x] 1.4 Add registry parity regression tests per surface (epub, pdf-fixed/reflow, markdown, html, transcript, rss) proving the pre-migration action sets are unchanged — the spec scenario "EPUB selection menu keeps its full action set"

## 2. HTML selection context parity

- [x] 2.1 Extend `buildTextSelectionContext` (`src/utils/textHighlights.ts`) to capture a `WebSelectionAnchor` (exact/prefix/suffix bounded to ~64 chars, optional container selector) without extra DOM passes; verify unit tests cover multi-paragraph ranges, inline links inside the range, Unicode, and RTL text
- [x] 2.2 Pass `buildSelectionContext` in the HTML iframe V2 registration (`DocumentViewer.tsx:1537-1560`); verify a test asserting the controller's `CapturedSelection.selectionContext` is a `TextSelectionContext{surface:"html"}` captured synchronously at settle (no reliance on the legacy `updateSelection` path)
- [x] 2.4 Make the HTML iframe bridge load-aware (`selectionInteraction/htmlSelectionBridge.ts`): a srcDoc navigation replaces the iframe Document after mount, killing the once-attached bridge listeners — on touch devices the machine never saw the selection and only Android's native pill (Copy/Share/Select All) appeared instead of Plethora's action bar. Re-attach on every iframe load; verified by the task-2.4 surfaceIntegration test (bridge attached before content exists → late load → touch select → ready with anchored context)
- [x] 2.3 Fix `attachHtmlIframeContextMenuListener` (`DocumentViewer.tsx:6536-6563`) to capture and forward the real selection context instead of `null`; verify a test asserting a desktop right-click extract on an html article persists offsets + anchor, and a highlight created via that menu repaints after document reopen

## 3. Menu lifecycle and keyboard access

- [x] 3.1 Verify and, where missing, add Escape-to-close and arrow-key navigation/Enter activation to the desktop selection context menu; verify with a keyboard-interaction test on the menu component
- [x] 3.2 Verify viewport-edge placement of the anchored bar and context menu for html selections (top/bottom/side edges, safe insets, Android system-selection-toolbar clearance) using the existing `placeAnchoredBar` geometry tests extended with html-surface cases

## 4. Durable web anchors: navigation and repaint

- [x] 4.1 Extend `locatorFromSelectionContext` (`src/utils/cardSourceNavigation.ts`) to emit `{ kind: "html", textQuote, selector }` from the stored anchor (offsets stay the fast path, quote resolution gated by `countQuoteMatches`); verify unit tests for: unique quote lands exactly, regenerated content still resolves, absent quote degrades to coarse open without error, and legacy offsets-only contexts still resolve via the existing fallback
- [x] 4.2 Extend `applyAnchoredTextHighlights` with quote-anchor fallback when offset application fails its existing validation; verify tests prove repaint after simulated re-import and that ambiguous matches are skipped without blocking other highlights
- [x] 4.3 Add an integration test for the chain web selection → extract → flashcard → view source: the saved article opens, scrolls to the originating passage, and highlights it

## 5. In-article hyperlink routing

- [x] 5.1 Add the iframe link click interceptor (parent-side, same-origin): same-document fragment links navigate natively, external links are routed, disallowed schemes (`javascript:`, non-http(s)/mailto) never activate; verify unit tests with fixture articles containing footnotes, external links, and `javascript:` hrefs
- [x] 5.2 Implement link actions: open in the in-app browser surface (default), Save to Plethora (runs the article import pipeline), Open externally, Copy link — surfaced via link right-click on desktop (no text selection) and long-press on mobile; verify component tests for the link menu and its four actions
- [x] 5.3 Verify selection spanning inline links is unaffected by link handling (full text captured, menu offered); covered by the 2.1 unit tests plus a manual check task 7.3

## 6. Capture-failure preservation

- [x] 6.1 Implement `persistWebArticleFailure(url, reason)` and call it from the `processSharedBatch` catch path and the PWA share-target handler; verify a unit test asserting a capture-failed share leaves a library document with `metadata.captureFailed` and the original URL retrievable, and that the interactive dialog path is unchanged
- [x] 6.2 Add the `capture-failed` kind to `classifyHtmlReader` with a reader notice offering Retry and Open Original; verify a component test for both actions (Retry re-runs the pipeline and updates the same document id in place; Open Original invokes the external opener)
- [x] 6.3 Verify dedupe: re-sharing/retrying the same canonical URL updates the existing capture-failed source instead of creating a duplicate; unit test against `find_document_id_by_source_url`

## 7. Verification gates

- [x] 7.1 Run `npx tsc --noEmit` and the full vitest suite (`npm run test` / `npm run test:unit` as configured); all green
- [x] 7.2 Run `npm run bench:check`; if selection-path costs intentionally changed, update `scripts/perf-baselines.json` in the same change with justification
- [ ] 7.3 Manual platform pass on Linux desktop and Android: save a hyperlink from the browser/share sheet → open in reader → select multi-paragraph text → menu on right-click and touch → Summarize, Extract, Flashcard, Highlight, Copy → view source from the flashcard returns to the passage → EPUB selection still behaves identically → confirm no network request on menu open and canonical articles remain script-free (devtools network panel)
- [x] 7.4 Run `openspec validate hyperlink-selection-context-actions --strict` and fix any reported issues
