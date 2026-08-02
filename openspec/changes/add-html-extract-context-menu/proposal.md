## Why

HTML documents imported via the Browser Extension render in an iframe (`docType === "html"` in [DocumentViewer.tsx](src/components/viewer/DocumentViewer.tsx)) that only wires an `onMouseUp` handler, not `onContextMenu`. As a result, right-clicking selected text in an imported HTML document does nothing — no context menu, no Create Extract action — while the same right-click on an EPUB or Markdown document opens a full text-selection context menu (Create Extract, Create Extract with dialog, Highlight, Copy, Dictionary Lookup, Create Flashcard). This is a functional gap for a common document type: users who clip web pages have no reliable, discoverable way to extract a selection other than a keyboard shortcut.

## What Changes

- Wire a right-click context menu into the HTML document iframe (both the primary browser-extension HTML viewer and the OCR "HTML view" iframe) that mirrors the existing EPUB/Markdown context menu: Create Extract, Create Extract (with dialog), Highlight (color submenu), Copy, Dictionary Lookup, Create Flashcard.
- Reuse the existing `ContextMenu` component, `buildContextMenuItems` builder, and `contextMenuState` plumbing already used by EPUB and Markdown viewers — no new menu implementation.
- Capture selection context (selected text, iframe coordinates) at `contextmenu` time from inside the sandboxed iframe, translating iframe-local coordinates to page coordinates for correct menu placement, the same race condition class already solved for EPUB in `add-html-extract-context-menu`'s prior art (`fix-epub-context-menu`).
- Ensure the menu is suppressed when no text is selected, consistent with the EPUB/Markdown behavior.

## Capabilities

### New Capabilities

- `html-document-context-menu`: Right-click text-selection context menu for HTML documents (browser-extension imports and OCR HTML view), providing the same extract/highlight/copy/dictionary/flashcard actions already available in EPUB and Markdown viewers.

### Modified Capabilities

(none — no existing spec covers HTML-viewer selection actions)

## Impact

- `src/components/viewer/DocumentViewer.tsx` — add `onContextMenu` wiring to the HTML iframe(s) (`docType === "html"` branch and the OCR `ocrResult.format === "html"` branch), reuse `buildContextMenuItems`/`contextMenuState`, extend the `docType !== "pdf"` render guard for the `ContextMenu` (already true for html, just needs the state to be populated).
- No changes needed to `ContextMenu.tsx`, `MobileContextMenuSheet.tsx`, or the extract/highlight/flashcard action handlers — they are format-agnostic already.
