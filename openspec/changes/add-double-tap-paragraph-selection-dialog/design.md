## Context

Plethora features diverse reading and queue surfaces: MarkdownViewer, EPUBViewer, PDFViewer (Reflow and Fixed modes), HTML documents, and QueueScrollPage (RSS articles, extracts, and document items).

Currently, capturing or interacting with an entire paragraph requires manual dragging of touch handles or triple-clicking, which can be clumsy on mobile devices and trackpads. Double-tapping on web content traditionally selects a single word or attempts viewport zooming. By detecting a double-tap/double-click on a paragraph block and selecting the entire paragraph range, users can instantly access extract creation, AI analysis (summarize, explain, simplify), vocabulary lookup, and note-taking dialogs.

## Goals / Non-Goals

**Goals:**
- Enable double-tap (touch) and double-click (desktop) on any paragraph container to select the full paragraph text.
- Automatically activate the existing text selection UI (e.g., `SelectionActionBar`, `SelectionActionsSheet`, `ContextMenu`, or `CreateExtractDialog`) immediately after selection.
- Support all main reader and queue surfaces: Markdown, EPUB (iframe-bridged), PDF Reflow, HTML viewer, and Queue scroll articles.
- Preserve smooth scrolling, single-tap actions (like reader tap-zones or link clicks), and manual selection drag gestures without interference.

**Non-Goals:**
- Altering triple-click behavior or replacing fine-grained sub-paragraph text selection.
- Applying paragraph selection gestures to media views (video playback, raw canvas).
- Intercepting double-taps on interactive controls (links, buttons, copy buttons, code block actions).

## Decisions

### 1. Centralized Gesture Detection in Selection Adapters
- **Choice**: Implement double-tap detection in `attachTopDocumentAdapter` and `attachContentDocumentBridge` in `src/components/viewer/selectionInteraction/adapters.ts`.
- **Rationale**: Centralizing in the selection interaction adapters ensures consistent behavior across all reader surfaces without duplicating touch tracking logic in every viewer component.
- **Alternatives Considered**:
  - Component-level `onDoubleClick` / `onTouchStart` hooks on every `<p>` element: High maintenance overhead and wouldn't easily cover iframe-based readers (EPUB/HTML).

### 2. Paragraph Element Resolution
- **Choice**: When a double-tap is detected on a content node, find the closest enclosing paragraph element using `target.closest("p, blockquote, [data-pdf-reflow-block], li")`.
- **Rationale**: Captures standard prose paragraphs as well as blockquotes, list items, and PDF reflow blocks while ignoring document root wrappers or UI chrome.
- **Exclusions**: Abort if the target matches `a, button, input, [role="button"], [data-selection-interaction-ui]`.

### 3. Programmatic Range Selection and Machine Synchronization
- **Choice**: Create a DOM `Range` covering the paragraph via `range.selectNodeContents(paragraphElement)` (or boundary text nodes), set it to `window.getSelection()`, and emit the settle event with `gestureOrigin: "double-tap"`.
- **Rationale**: Reuses the entire existing selection controller pipeline (`useSelectionInteraction`, placement calculation, `SelectionActionBar`, `SelectionActionsSheet`), ensuring complete feature parity with standard text selection.

### 4. Handling Iframe Bridges (EPUB and HTML)
- **Choice**: Detect double-taps inside `attachContentDocumentBridge` within the iframe's `contentDocument`, construct the range using the iframe's `Selection` API, and forward the selection context and bounding rect to the parent host.
- **Rationale**: EPUB and standalone HTML render inside isolated iframes where top-level event listeners cannot reach internal DOM nodes directly.

## Risks / Trade-offs

- **[Risk]** Mobile browser double-tap zoom interference.
  - **Mitigation**: Call `preventDefault()` on the second tap when double-tap criteria are met on a paragraph, and ensure reader content containers use appropriate CSS touch actions (`touch-action: manipulation` or `touch-action: pan-y`).
- **[Risk]** Selection flicker or accidental dismiss on rapid taps.
  - **Mitigation**: The selection state machine enforces minimum settle thresholds and ignores extraneous touch releases during the double-tap window.
- **[Risk]** Inadvertently selecting huge containers if `p` is missing.
  - **Mitigation**: Constrain paragraph resolution strictly to paragraph-level block tags (`p`, `blockquote`, `li`, `[data-pdf-reflow-block]`) and check maximum character/node boundaries so parent container divs are never accidentally selected in entirety.
