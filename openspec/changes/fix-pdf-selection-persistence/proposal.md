## Why

Selecting text in the PDF viewer is unreliable: the highlight often disappears the moment the drag ends or focus moves to the popup/assistant panel, and the selected range frequently does not match the glyphs the user dragged over. Selection is the entry point for copy, highlight, extract, and card creation, so this makes the core reading loop feel broken.

The interesting part is that upstream PDF.js (used by Firefox's built-in viewer and by the Chrome/Edge PDF.js extensions) does *not* have this problem. Investigation shows we broke it ourselves in two ways, both fixable without inventing a new selection engine:

1. **`src/components/viewer/PDFViewer.css` overrides PDF.js's own text-layer stylesheet with pre-v3 rules and `!important`.** `pdf_viewer.css` is imported at `PDFViewer.tsx:77`, then `PDFViewer.css:111-222` re-declares `.textLayer`, `.textLayer span`, and `.textLayer span.markedContent`. Two of these are actively destructive on PDF.js 5.4:
   - `.textLayer span.markedContent { top: 0; height: 0; display: block }` overrides upstream's `display: contents`. Marked-content wrappers become zero-height blocks, so every span inside them is positioned against a collapsed box. The browser's hit-testing and range-ordering then disagree with what is painted — this is the "selects the wrong text" symptom.
   - `.textLayer span { line-height: 1 !important; box-sizing: content-box !important; margin/padding/border reset }` fights upstream's `font-size: calc(var(--text-scale-factor) * var(--font-height))` + `transform: rotate() scaleX() scale(var(--min-font-size-inv))` sizing model, mis-sizing span boxes relative to the rendered glyphs.
   - `overflow: hidden` instead of upstream `overflow: clip` makes the layer a scroll container, which shifts selection geometry.

2. **The viewer's own mousedown handler cancels the gesture PDF.js relies on.** `PDFViewer.tsx:2478-2503` calls `e.preventDefault()` and `window.getSelection()?.removeAllRanges()` whenever the mousedown target *is* the text-layer root (i.e. inter-line whitespace — the most common place a drag starts). Upstream handles exactly that case with the `.endOfContent` element and the `.selecting` class; our handler pre-empts it, so drags that begin in whitespace either select nothing or nuke the previous selection.

Separately, this app is not a browser tab: it is a Tauri/WKWebView window with a side assistant panel and a floating selection popup. Even a correct native selection is dropped by WKWebView when focus moves to another element. Upstream PDF.js never has to solve this. So visual persistence cannot rely on the live native selection alone.

## What Changes

- Delete the conflicting `.textLayer*` rules from `PDFViewer.css` and defer to the bundled `pdfjs-dist/web/pdf_viewer.css`, keeping only app-specific selection tint and z-index/stacking rules that do not contradict upstream layout.
- Stop intercepting the whitespace mousedown: remove the `preventDefault()` + `removeAllRanges()` branch so PDF.js's `endOfContent`/`selecting` machinery handles drags that begin between lines.
- Persist the committed selection visually with an overlay of the range's client rects, painted per page, so the passage stays highlighted after mouseup even when the native selection is dropped (focus moves to the popup, the assistant input, or another panel).
- Define explicit clear semantics for the persisted highlight: new drag inside a page, click outside any page, `Escape`, page/zoom change that invalidates geometry, or an explicit action (extract/highlight created, or popup dismissed).
- Reposition the persisted overlay on zoom and page-relayout so it keeps tracking the passage instead of drifting or vanishing.
- Remove the dead custom selection engine (`src/components/viewer/selection/*`, gated off by `ENABLE_CUSTOM_PDF_SELECTION = false` at `PDFViewer.tsx:264`) and its CSS, or reuse its renderer for the persistence overlay — one or the other, not both.
- Add regression coverage: a CSS-conflict guard, unit tests for the selection commit/clear state machine, and a manual verification checklist against a multi-column, marked-content-heavy PDF.

## Capabilities

### New Capabilities
- `pdf-selection-persistence`: Accurate text-layer selection on PDF pages, and a committed selection that stays visibly highlighted across focus changes until an explicit clear.

### Modified Capabilities
<!-- None. `pdf-text-selection-actions` (proposed in the unarchived `fix-pdf-text-selection` change) covers what happens *after* a selection exists; its requirements are unchanged. This change is about producing and keeping a correct selection in the first place. -->

## Impact

- Affected code: `src/components/viewer/PDFViewer.css` (text-layer rules — mostly deletions), `src/components/viewer/PDFViewer.tsx` (mousedown/mouseup/selectionchange handlers ~L2364-2540, `ENABLE_CUSTOM_PDF_SELECTION` wiring ~L264/717-790), `src/components/viewer/PdfPageView.tsx` (overlay stacking), `src/components/viewer/selection/*` (removal or repurposing), `src/components/viewer/HighlightLayer.tsx` (overlay reuse).
- Depends on `pdfjs-dist` 5.4.624 shipping `pdf_viewer.css` — the fix is to stop overriding it, so future PDF.js upgrades stop regressing selection.
- Relates to the existing unarchived change `fix-pdf-text-selection`, which fixed the *actions* on a selection; this change fixes the selection itself. No conflict, but they touch the same handlers.
- No data migration. No change to stored highlight/extract formats.
- Platform focus: macOS/WKWebView (the reported environment); behaviour must not regress on Chromium/Linux/Windows webviews.
