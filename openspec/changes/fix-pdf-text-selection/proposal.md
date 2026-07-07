## Why

PDF text selection is a core reader workflow because it feeds copy/paste, highlighting, extract creation, and learning-item creation. Users report that they cannot reliably select and extract text from PDFs, so the app needs an end-to-end repair of the text-backed PDF selection path rather than only rendering pages correctly.

## What Changes

- Restore reliable browser-style text selection on text-backed PDF pages rendered by the in-app PDF viewer.
- Ensure selected PDF text can be copied using normal platform copy behavior.
- Ensure the PDF selection popup can create highlights/extracts from valid PDF text selections without requiring manual copy/paste.
- Ensure selected PDF text and PDF page/document context flow into existing extract and learning-item creation paths.
- Prevent empty, collapsed, image-only, or non-PDF UI selections from enabling PDF extract/highlight actions.
- Add regression coverage and manual verification for text-backed PDFs, mixed/no-text-layer PDFs, copy, highlight, extract, and learning-item handoff.

## Capabilities

### New Capabilities
- `pdf-text-selection-actions`: End-to-end select, copy, highlight, extract, and learning-item actions for text-backed PDF selections.

### Modified Capabilities
- `toast-extract-feedback`: Ensure PDF selection popup highlight/extract actions use the instant extract feedback path only when a valid PDF text selection exists.

## Impact

- Affected areas: `PDFViewer`, PDF.js text-layer mounting/styling, selection filtering, `SelectionPopup`, `DocumentViewer` selection state, extract creation payloads, learning-item/flashcard handoff, and PDF-focused tests.
- No data migration is required.
- Image-only PDFs remain best-effort through OCR flows; this change does not add new OCR extraction capability.
