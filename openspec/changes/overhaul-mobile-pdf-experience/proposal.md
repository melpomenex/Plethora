## Why

PDFs imported on native mobile can fail before rendering with `Failed to load PDF: Failed to fetch` because PDF.js is asked to fetch a Tauri asset URL that is not consistently readable from the mobile WebView. Even when a PDF loads, shrinking a fixed desktop-sized page onto a phone is not a comfortable reading experience, so mobile needs a reliable loading path plus a reflow-first reader with graceful handling for complex and scanned documents.

## What Changes

- Replace the fragile mobile asset-URL-only PDF loading path with a native, range-capable document source that PDF.js can consume without WebView fetch/CORS assumptions or whole-file JavaScript allocations.
- Add structured PDF analysis and cached semantic extraction so text PDFs can be presented as responsive, single-column HTML while preserving headings, paragraphs, lists, tables, figures, links, page anchors, and reading order where detectable.
- Add an OCR fallback for scanned or text-poor PDFs, with explicit progress, cancellation, language selection, quality messaging, and partial-page availability instead of a blocking conversion.
- Make reflow the recommended/default mobile mode when extraction quality is sufficient, while retaining fixed-layout, fit-to-width, crop-to-content, landscape, and original-page inspection modes for layouts that should not be flattened.
- Add mobile-native reader controls for mode switching, typography, table of contents, page/progress navigation, search, selection, highlights, extracts, and position restoration.
- Preserve a stable mapping between reflowed content and source PDF pages/coordinates so annotations, assistant context, citations, and “view original page” remain trustworthy.
- Add actionable recovery states for missing, corrupt, encrypted, unsupported, and not-yet-synced PDFs; never expose a raw `Failed to fetch` message as the primary user guidance.

## Capabilities

### New Capabilities

- `mobile-pdf-loading`: Reliable, memory-bounded PDF access on native mobile with range reads, diagnostics, retry, and user-facing recovery states.
- `pdf-semantic-reflow`: Quality-gated conversion of text and scanned PDFs into cached, responsive semantic content with source-page mappings.
- `mobile-pdf-reader`: A polished phone reader that coordinates reflow and fixed-layout modes, controls, navigation, preferences, annotations, and position continuity.

### Modified Capabilities

None.

## Impact

- Frontend: `DocumentViewer`, `PDFViewer`, PDF source creation, mobile reader chrome, document settings, highlights/extract selection, search, and reader-position serialization.
- Native backend: new file metadata/range-read commands; expanded PDF structure extraction, conversion cache, OCR orchestration, cancellation, and cache invalidation.
- Data: additive persisted PDF analysis/reflow metadata and source anchors; existing PDFs and annotations remain compatible.
- Tests: Rust extraction/range tests, frontend source/reflow/navigation tests, and device QA on Android and iOS across text, multi-column, scanned, encrypted, malformed, and large PDFs.
- Dependencies: prefer the existing Rust PDF extraction/OCR stack and PDF.js APIs; do not copy or link KOReader/K2pdfopt AGPL code as part of this change.
