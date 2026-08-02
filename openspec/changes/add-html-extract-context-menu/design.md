## Context

`DocumentViewer.tsx` already has a working, format-agnostic text-selection context menu system: `contextMenuState`, `buildContextMenuItems(selectedText, selectionContext)`, and the `<ContextMenu>` render at the bottom of the component (gated on `docType !== "pdf"`, since PDF uses its own `SelectionPopup`). EPUB (`EPUBViewer.tsx`) and Markdown (`MarkdownViewer.tsx`) each attach a `contextmenu` listener inside their own content root and call an `onContextMenu` prop with `{x, y, selectedText, selectionContext}`; `DocumentViewer` wires that prop to `setContextMenuState(...)`.

HTML documents (`docType === "html"`, used for Browser Extension imports and other HTML sources) and the OCR "HTML view" (`pdfViewMode === "ocr-html"` with `ocrResult.format === "html"`) render their content in a sandboxed `<iframe srcDoc={...}>`. Neither iframe has a `contextmenu` listener or an `onContextMenu` prop — only `onMouseUp={handleIframeMouseUp}`, which populates `selectedText` for other consumers (e.g. keyboard-shortcut extract) but never opens the context menu. This is a straightforward gap, not a design problem: the menu system, action handlers, and iframe-coordinate-translation pattern (already solved for EPUB, see `contents.document.addEventListener("contextmenu", ...)` in `EPUBViewer.tsx`) all exist; they just aren't connected for this one document type.

## Goals / Non-Goals

**Goals:**
- Right-clicking selected text inside an HTML document (both the primary HTML viewer and OCR HTML view) opens the same `ContextMenu` with the same action set as EPUB/Markdown.
- Selection context passed to actions is correct (selected text is accurate; extract/highlight land on the right document).
- Coordinate translation from iframe-local to page coordinates is correct so the menu appears at the cursor, not offset.

**Non-Goals:**
- No new menu UI, no new actions beyond what EPUB/Markdown already expose (Create Extract, Create Extract with dialog, Highlight submenu, Copy, Dictionary Lookup, Create Flashcard).
- No change to the PDF `SelectionPopup` flow.
- No change to the mobile lightbulb selection button — it is already `docType`-agnostic (driven by `mobileSelection`, not `docType`) and is out of scope unless testing reveals it doesn't already cover HTML (see Open Questions).

## Decisions

- **Reuse `contentDocument.addEventListener("contextmenu", ...)` inside the iframe**, mirroring `EPUBViewer.tsx`'s pattern, attached in the iframe's `onLoad` handler (where `injectHtmlViewerStyles()` already runs) rather than via a React `onContextMenu` prop on the `<iframe>` element itself — a React `onContextMenu` on the `<iframe>` tag only fires for the iframe's own border/chrome, not its document content, since the iframe is a separate document context. This matches why EPUB attaches the listener to `contents.document` rather than to a JSX prop on its outer container.
- **Translate coordinates using `iframe.getBoundingClientRect()` + the inner `MouseEvent`'s `clientX/clientY`**, identical to the EPUB implementation, so the menu positions correctly regardless of iframe scroll offset.
- **Selection context payload**: for HTML, `selectionContext` can stay minimal (selected text plus whatever `updateSelection`/`computeExtractPageNumber` already derive from `docType === "html"` scroll state) — there is no CFI/page-range equivalent to compute, unlike EPUB. Reuse the existing `updateSelection` derivation already invoked from `handleIframeMouseUp`'s sibling code paths.
- **Apply the same wiring to both HTML iframes**: the primary `docType === "html"` iframe and the OCR `ocrResult.format === "html"` iframe, since both currently lack the listener and both are otherwise treated as "HTML view" throughout `DocumentViewer.tsx`.
- **No new capability boundary needed in `ContextMenu.tsx`**: the `docType !== "pdf"` render guard for `<ContextMenu>` already includes `"html"`; only the event source was missing.

## Risks / Trade-offs

- [Sandboxed iframe (`sandbox="allow-same-origin allow-scripts"`) could theoretically block `contentDocument` access] → Already proven safe: `handleIframeMouseUp` and `injectHtmlViewerStyles` already read/write `iframe.contentDocument` successfully with the same sandbox attributes, so `addEventListener("contextmenu", ...)` on the same document is equally safe.
- [Attaching the listener on every `onLoad` without removing prior listeners could accumulate duplicate listeners across re-renders/re-loads] → Follow the same lifecycle EPUB uses (listener attached fresh each time `rendition`/iframe content is (re)loaded, old iframe document is discarded on reload since `srcDoc` remounts a new document); confirm via the iframe's `key={...}` remount behavior already in place (`key={`${currentDocument.id}:${htmlFrameRevision}`}`), which guarantees a fresh document per load and avoids listener buildup.
- [Right-click default browser menu suppression] → Call `e.preventDefault()` only when there is a non-empty selection, matching EPUB/Markdown, so right-click without a selection still shows the native menu (or nothing), consistent with existing behavior elsewhere.

## Open Questions

- Whether the mobile lightbulb selection button already appears for HTML documents (it appears to be `docType`-agnostic via `mobileSelection.showButton`) — verify during implementation/testing rather than changing code speculatively.
