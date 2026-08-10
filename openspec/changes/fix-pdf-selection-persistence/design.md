## Context

The viewer hosts PDF.js 5.4.624 `PDFPageView` instances (`src/components/viewer/PdfPageView.tsx`), one per page, inside React-owned slots. `pdfjs-dist/web/pdf_viewer.css` is imported at `PDFViewer.tsx:77`, immediately followed by `./PDFViewer.css`, which re-declares the text-layer rules with `!important`. Native browser selection is used; a disabled geometric selection engine (`src/components/viewer/selection/*`, ~1,600 lines) sits behind `ENABLE_CUSTOM_PDF_SELECTION = false` (`PDFViewer.tsx:264`).

Three facts drive this design:

1. Upstream PDF.js selection is accurate in Firefox and Chrome because its text layer's CSS and its `endOfContent` mousedown machinery are used exactly as shipped. We ship the same code but override both.
2. The app's overriding CSS is stale — `.textLayer span.markedContent { display: block; height: 0 }` is a pre-v3 convention; PDF.js 5 uses `display: contents` and CSS-variable-driven `font-size`/`transform` sizing (`pdf_viewer.css:908-935`).
3. Even a correct native selection is not enough here. This is a WKWebView window with a side assistant panel and a floating popup; WKWebView drops the document selection when focus moves. A browser tab never faces this, which is why upstream has no persistence layer to copy.

The current handlers already reflect painful workarounds for symptom (3): a mouseup-only commit, an `ignoreSelectionChangeRef` window, and a `pdfTextSelectionGestureActiveRef` guard (`PDFViewer.tsx:2364-2540`). Those stay conceptually, but the visual persistence stops depending on the live native selection.

## Goals / Non-Goals

**Goals:**
- Selection ranges match the glyphs dragged over, including marked-content and multi-column pages, at any zoom.
- A committed selection remains visibly highlighted until an explicit clear.
- Future `pdfjs-dist` upgrades stop regressing selection, because we no longer fight upstream CSS.
- Net code reduction.

**Non-Goals:**
- Building a geometric selection engine. The existing disabled one is being removed, not revived.
- Touch/mobile selection handles. Desktop pointer selection is the reported problem; touch behaviour must not regress but gains no new affordances.
- Changing what selection actions do (extract, highlight, card creation) — that is `fix-pdf-text-selection`'s scope.
- Selection across page boundaries beyond what the native selection already produces.

## Decisions

### D1: Delete conflicting CSS rather than tune it

Remove the layout-affecting `.textLayer*` rules from `PDFViewer.css` and rely on the imported `pdf_viewer.css`. Keep only: the selection tint (`.textLayer ::selection`), the stacking/z-index rules that place the text layer above the canvas and below the app overlays, and `cursor: text`.

*Alternative considered:* adjust the overrides to match PDF.js 5's model (e.g. change `markedContent` to `display: contents`, drop `line-height: 1 !important`). Rejected — it re-creates the same coupling that broke on the last upgrade. Every rule kept must be justified as app-specific, not layout.

*Verification:* a test asserts no app stylesheet declares layout properties on text-layer selectors, so the coupling cannot silently return.

### D2: Delegate whitespace mousedown to PDF.js

Delete the `clickedTextLayerWhitespace` branch in `PDFViewer.tsx:2485-2503` (`preventDefault()` + `removeAllRanges()`). PDF.js's `TextLayerBuilder` already handles a mousedown on the layer root: it adds `.selecting`, which moves `.endOfContent` to `top: 0` so the browser resolves the caret to the nearest text position instead of selecting from the container's top edge. That branch exists precisely because the app's `overflow: hidden` + `markedContent` overrides broke `endOfContent`; with D1 applied, it is obsolete.

*Alternative considered:* keep `preventDefault()` but reposition `endOfContent` ourselves. Rejected — that is re-implementing upstream.

### D3: Persist the selection as an overlay of range client rects

On the existing mouseup commit, capture `range.getClientRects()`, convert to page-relative rects per page container, and store them alongside the already-built `PdfSelectionContext`. Render them as an absolutely-positioned overlay per page. The overlay is the source of truth for what the user *sees* as selected; the native selection remains the source of truth for what was selected (text, context) but its visual disappearance no longer matters.

The existing `PdfSelectionContext` already carries per-page `viewportRects` (`hasUsablePdfSelectionContext` in `pdfTextSelection.ts:74-83`), so no new data shape is needed — the overlay renders `context.pages[].viewportRects`.

*Alternative considered:* keep the native selection alive by re-applying the range whenever it is lost (`selectionchange` → `addRange`). Rejected — it fights the webview, steals focus back from the popup/assistant input, and is exactly the kind of loop that produces the current flicker.

*Alternative considered:* suppress the native tint entirely and paint only the overlay. Deferred — during the drag, the native tint is what gives live feedback and is correct once D1 lands. The overlay only takes over at commit time; a brief double-paint at identical geometry is acceptable and the native tint disappears on its own when focus moves.

### D4: Reuse `HighlightLayer`'s rendering approach, delete the custom selection engine

`HighlightLayer.tsx` already paints viewport-relative rects over a page and is already mounted per page in `PdfPageView.tsx:251-270` with `pointer-events: none`. The persistence overlay is the same shape of thing — render it there rather than adding a third overlay stack.

`src/components/viewer/selection/*` (engine, spatial index, token extractor, renderer, hook, types — ~1,600 lines) has been dead behind a `false` flag; its call sites in `PDFViewer.tsx` (L717-790) and its CSS block (`PDFViewer.css:255-313`) go with it. Its `SelectionRenderer` may be lifted verbatim if it is a better fit than `HighlightLayer` for the overlay, but only one survives.

*Alternative considered:* keep the engine as a fallback for pages where native selection fails. Rejected — it has never shipped enabled, so it is untested in production, and maintaining two selection paths is what produced the current tangle.

### D5: Recompute overlay geometry on scale change; clear when the page unmounts

`onViewportChange` already fires per page on zoom (`PdfPageView.tsx:222`). On scale change, re-derive overlay rects from the stored PDF-space rects (`context.pages[].pdfRects`) through the new viewport, so the highlight tracks the passage. If the selection's page is no longer rendered (virtualization), the overlay for that page is simply not painted; the committed state survives so scrolling back re-paints it.

### D6: Clear semantics, centralized

One `clearPersistedSelection()` path, called from: pointer-down that starts a new in-page selection, click outside any page, `Escape`, document change, and action completion. The current code has clearing logic scattered across `handleMouseDown`, `handleMouseUp`, `handleSelectionChange`, and `clearSelection` with overlapping guards; consolidating is required for the spec's "idle does not clear" scenario to hold.

Notably, `handleSelectionChange`'s "native selection went empty → clear everything" branch (`PDFViewer.tsx:2439-2444`) must no longer clear the *overlay* — that branch firing on focus loss is the headline bug.

## Risks / Trade-offs

- **Removing the CSS overrides changes visual details** (glyph box sizes, selection tint edges, layer clipping) → land D1 first and eyeball a text-heavy, a multi-column, and a scanned+OCR PDF before building on it. Any rule that is genuinely needed comes back individually with a comment saying why.
- **The overlay and the native tint can both paint briefly** → identical geometry, so it reads as one highlight; if it does not, D3's deferred alternative (suppress the native tint post-commit via `::selection { background: transparent }` on a committed class) is the escape hatch.
- **Deleting the custom selection engine is irreversible in-branch** → it is in git history and behind a permanently-`false` flag; recovering it is a revert, not a rewrite.
- **Overlay rects drift if `pdfRects` were captured at a stale viewport** → derive overlay geometry from PDF-space rects, never from cached CSS pixels, so re-derivation at any scale is exact.
- **Chromium webviews may not need the persistence layer** → it is additive and geometry-identical; it should be invisible where the native selection already survives. Verify on both.
- **Regression surface is the same handlers `fix-pdf-text-selection` touched** → that change is unarchived and partially applied (18/26 tasks); reconcile before merging rather than reverting its work.

## Migration Plan

Ordered so each step is independently verifiable:

1. D1 (CSS deletion) — verify selection accuracy by hand. This alone may fix the "inaccurate" half.
2. D2 (whitespace mousedown) — verify drags starting between lines.
3. D4 removal of the dead engine — no behaviour change expected; a pure-deletion checkpoint.
4. D3 + D5 + D6 (persistence overlay and clear semantics) — the behavioural addition.

No data migration, no stored-format change, no feature flag. Rollback is a git revert of the relevant step.

## Open Questions

- Should the persisted overlay use the same tint as the native selection, or a distinct "committed" colour to signal that an action is pending? Defaulting to the same tint unless it proves confusing.
- Does the OCR flow (`ocrActive`) need to clear a persisted selection when it starts? Assuming yes; confirm against the OCR region selector's own pointer handling.
