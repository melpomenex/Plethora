## Why

In the document reader and queue views, selecting full paragraphs via touch gestures or drag-selection can be awkward and slow on mobile and desktop alike. Users frequently want to capture an entire paragraph as an extract, run AI actions (explain, summarize, simplify), add flashcards, or highlight the block. Allowing a double tap (or double click) directly on a paragraph to select the entire paragraph and immediately trigger the standard text selection dialog / action bar / bottom sheet streamlines reading, knowledge capture, and note taking.

## What Changes

- **Paragraph Double-Tap Gesture Detection**: Add double-tap/double-click gesture detection across reader and queue view content containers (Markdown, EPUB, PDF Reflow / Text layer, HTML, RSS reader in queue scroll mode, etc.).
- **Automatic Paragraph Text Selection**: When a double tap is detected on a paragraph block (`<p>`, block quote, reflow block, or equivalent paragraph container), programmatically select the full text content of that paragraph element.
- **Selection Dialog / Action Trigger**: Seamlessly invoke the existing text selection interaction flow (`SelectionActionBar` / `SelectionActionsSheet` on mobile touch shells, context menu or extract dialog on desktop) for the selected paragraph text and its context.
- **Non-Interference with Native Interactions**: Ensure single clicks, link clicks, scrolling gestures, text selection drag handles, and other interaction modes (like dictionary peeks or vim navigation) continue to work reliably without false triggers.

## Capabilities

### New Capabilities
- `paragraph-double-tap-selection`: Covers double-tap and double-click paragraph range selection and triggering of text selection action dialogs across document viewer and queue scroll/reader surfaces.

### Modified Capabilities
<!-- None -->

## Impact

- **Affected Code**:
  - `src/components/viewer/selectionInteraction/` (adapters, useSelectionInteraction hook, intent/gesture classification)
  - `src/components/viewer/` (`DocumentViewer.tsx`, `MarkdownViewer.tsx`, `EPUBViewer.tsx`, `PDFViewer.tsx`)
  - `src/pages/QueueScrollPage.tsx` / `src/components/queue/`
- **Dependencies**: No new external dependencies required; utilizes standard DOM Range/Selection APIs and existing Plethora selection interaction machinery.
- **Testing**: Unit tests and integration tests for double-tap detection, range selection on paragraphs, and action dialog triggering in document and queue views.
