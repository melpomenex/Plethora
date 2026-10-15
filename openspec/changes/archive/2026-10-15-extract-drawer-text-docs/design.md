## Context

Text-based documents (HTML, Markdown, plain text files) in Incrementum currently lack the persistent, premium selection drawer experience of EPUB documents. Furthermore, because HTML documents render inside sandboxed same-origin iframes, user interactions like clicking inside the iframe do not propagate to the parent document's `mousedown` handlers. This creates a friction point where selections cannot be dismissed naturally by clicking elsewhere inside the document. In the Queue view, RSS selections are handled by a basic, separate floating button without dictionary lookup or characters count badge.

## Goals / Non-Goals

**Goals:**
- Unify the persistent floating selection drawer behavior for `epub`, `markdown`, `html`, and `other` text documents inside `DocumentViewer.tsx`.
- Forward `mousedown` events from HTML viewer iframes to the parent window so that click-outside dismissal works seamlessly inside HTML/OCR documents.
- Redesign the RSS feed selection button in `QueueScrollPage.tsx` to use the same premium floating selection drawer design (with character counts and dictionary lookup).

**Non-Goals:**
- Redesigning the PDF non-OCR selection popup (which uses a custom, multi-color highlighting popup).
- Editing actual EPUB files (only standardizing the viewer's selection drawer).

## Decisions

### 1. Unify Selection Persistence Check in DocumentViewer
Update `activeExtractSelection` definition to evaluate to `selectedText || lastSelectionRef.current` for all text-based formats:
```tsx
const isTextBasedDoc =
  docType === "epub" ||
  docType === "markdown" ||
  docType === "html" ||
  docType === "other" ||
  (docType === "pdf" && pdfViewMode === "ocr-html");

const activeExtractSelection = isTextBasedDoc
  ? (selectedText || lastSelectionRef.current)
  : selectedText;
```

### 2. Forward mousedown events from HTML Viewer Iframes
In the HTML viewer `useEffect` inside `DocumentViewer.tsx`, attach a `mousedown` listener to the iframe document that clones and dispatches the event on the parent `window`. This propagates target checks to `handleClickOutside`.

### 3. Redesign RSS Selection Drawer in QueueScrollPage
Update `QueueScrollPage.tsx`'s RSS selection render block to display a rounded, glassmorphic container with the same button combination:
- "Create Extract" (showing character counts, styled identically to `DocumentViewer`'s button).
- "Lookup" (triggering dictionary lookup, styled identically).
Add state and async handlers for `isDictionaryLoading`, `dictionaryResult`, and `handleDictionaryLookup` inside `QueueScrollPage.tsx`.

## Risks / Trade-offs

- **[Risk]** iframe cross-origin access errors → **[Mitigation]** The iframe uses `srcDoc` and `sandbox="allow-same-origin allow-scripts"`, making same-origin access safe. We wrap accessing iframe `contentDocument` or `contentWindow` in try/catch blocks to prevent crashes on edge cases.
