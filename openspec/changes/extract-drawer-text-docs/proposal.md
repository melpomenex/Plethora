## Why

Text selection is a core interaction for active reading and incremental learning. Currently, EPUB documents offer a rich, premium floating action drawer (selection drawer) that facilitates instant extract creation and dictionary lookup, while HTML, Markdown, RSS, and other text documents lack this capability or have a very basic, inconsistent experience. Unifying this premium interaction across all text-based documents will dramatically improve usability, consistency, and alignment-focused reading UX.

## What Changes

- Implement the unified premium selection drawer for Markdown, HTML, and other text documents in `DocumentViewer.tsx`.
- Replace the basic RSS selection button in `QueueScrollPage.tsx` with the same premium selection drawer including character counts and dictionary lookup.
- Preserve selection drawer visibility after the text selection is cleared (matching the EPUB behavior), allowing users to comfortably click the button drawer.
- Forward click/mousedown events from the HTML/OCR-HTML iframe viewer to the parent window to ensure clicking outside dismisses the drawer cleanly.
- Style the drawer with high-end glassmorphic details, backdrop filters, and micro-animations for a premium feel.

## Capabilities

### New Capabilities
- `document-selection-drawer`: Rich floating selection drawer offering extract creation and dictionary lookup for all text-based documents (HTML, Markdown, RSS, and others).

### Modified Capabilities
<!-- None -->

## Impact

- `src/components/viewer/DocumentViewer.tsx`: Modify `activeExtractSelection` condition, add mousedown event forwarding for HTML viewer iframes, and ensure the floating drawer renders for all text documents.
- `src/pages/QueueScrollPage.tsx`: Replace basic RSS selection buttons with the premium selection drawer and implement dictionary lookup.
- Styling / CSS updates to ensure beautiful, consistent layout across both pages.
