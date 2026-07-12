## Context

On native mobile, `DocumentViewer` currently avoids `readDocumentFile()` for PDFs because base64 decoding and a whole-file `Uint8Array` can exhaust Android's JavaScript heap. It instead calls `convertFileSrc(doc.filePath)` and passes the resulting asset URL to PDF.js. That makes PDF.js perform a WebView fetch against a Tauri custom protocol; when the protocol, origin, permission, or range behavior is unavailable, PDF.js reports the browser-level `Failed to fetch` error. Retrying the PDF.js worker does not repair an unreadable source URL.

The app already has a sophisticated fixed-layout PDF.js viewer, source-coordinate highlights, OCR commands, and a Rust `convert_pdf_to_html` path. The converter currently extracts mostly plain page text and basic blocks; it is useful groundwork but does not yet provide sufficiently reliable reading order, source geometry, incremental conversion, quality classification, or a cache contract for a primary reader.

KOReader demonstrates that small-screen PDF UX needs multiple document-aware modes: reflow when text/layout extraction is suitable, fit/crop/column navigation when fixed layout matters, and OCR for scans. Incrementum should adopt that product model, but not copy KOReader's AGPL-licensed K2pdfopt implementation. Incrementum also needs semantic, selectable content with stable anchors for extracts, highlights, assistant citations, and cross-device reading state—requirements that favor a native/PDF.js semantic pipeline over raster-only reflow.

## Goals / Non-Goals

**Goals:**

- Eliminate WebView fetching as a required step for opening a local PDF on native mobile.
- Keep PDF access memory-bounded for large files and provide useful diagnostics/recovery.
- Make text-heavy PDFs read like responsive articles on phones without losing access to the original layout.
- Handle multi-column, mixed-content, scanned, encrypted, malformed, and partially synced PDFs honestly and predictably.
- Preserve source page and rectangle mappings across reflow, search, annotations, extracts, assistant context, and position restoration.
- Deliver fast first-readable-content, incremental background processing, persistent per-document preferences, and accessible touch UX.

**Non-Goals:**

- Replacing the desktop PDF.js viewer.
- Guaranteeing perfect semantic reconstruction of every arbitrary PDF layout.
- Editing PDF objects or writing Incrementum highlights back into the source PDF.
- Shipping or linking KOReader/K2pdfopt code.
- Converting the source PDF into a new user-visible document or deleting the original.

## Decisions

### 1. Feed PDF.js through a native range transport on mobile

Add Tauri commands that validate a document-owned path and return immutable file identity/metadata plus bounded byte ranges. A frontend `NativePdfRangeTransport` will adapt those commands to PDF.js `PDFDataRangeTransport`: bootstrap with a small initial chunk, fulfill `requestDataRange(begin, end)` asynchronously, coalesce duplicate/adjacent requests, cap concurrent reads, and stop cleanly when the viewer closes.

This avoids custom-protocol fetch/CORS behavior and avoids base64 or whole-file copies in the WebView. Ranges are binary IPC payloads where supported; if the Tauri bridge serializes bytes, chunks remain bounded. The source controller retains the existing byte/URL paths for desktop and web, and a guarded whole-file fallback only for files below a tested threshold.

Alternatives considered:

- **Keep `convertFileSrc` and adjust CSP/permissions:** rejected as the primary fix because PDF.js still depends on WebView custom-protocol fetch and correct byte-range semantics across Android/iOS versions.
- **Always load the complete file through IPC:** rejected because the existing mobile OOM concern is valid for large PDFs.
- **Run a localhost HTTP server:** rejected due to lifecycle, port, security, and backgrounding complexity.

Native range commands MUST canonicalize and authorize paths using the same document-library boundary as existing file commands, reject invalid ranges, cap response size, and return typed errors. A file identity composed from canonical document identity, size, modification time, and a lightweight content fingerprint invalidates stale reads and caches.

### 2. Use an incremental semantic document model, not raw HTML as the source of truth

Introduce a versioned `PdfReflowDocument` cache containing document analysis and ordered `PdfReflowBlock` records. Blocks represent headings, paragraphs, lists, tables, figures/captions, footnotes, equations/code-like content, and page boundaries. Every block carries a stable ID, source page(s), source rectangles/token spans when available, extraction method, language/direction, and confidence. Rendering produces sanitized React/HTML from this model; generated HTML is never persisted as trusted executable content.

For text PDFs, PDF.js page text items and geometry are the primary input because they match the renderer's coordinate system. A layout analyzer groups glyphs into lines/blocks, detects columns and repeated headers/footers, and derives conservative semantics. Pages are processed incrementally around the current position, then outward during idle/background time. Results are persisted through native cache commands so reopening does not reconvert unchanged pages.

The current Rust converter can be refactored to share block rendering and cache serialization, but its whole-document plain-text output is not used as the quality authority. Browser/PWA mode may keep an in-memory/IndexedDB implementation of the same schema.

Alternatives considered:

- **Persist Markdown only:** rejected because Markdown cannot faithfully encode source rectangles, confidence, complex tables/figures, or rich navigation metadata.
- **Persist generated HTML only:** rejected because safe upgrades, source mapping, and alternate renderers become fragile.
- **Raster reflow like K2pdfopt:** rejected as the default because selection, search, accessibility, text styling, and source-aware learning workflows are core product requirements.

### 3. Quality-gate automatic reflow and keep fixed layout one gesture away

The analyzer assigns page- and document-level capabilities: `semantic`, `semantic-with-warnings`, `ocr-required`, or `fixed-layout-recommended`. Signals include text coverage, extraction errors, reading-order ambiguity, overlapping blocks, table/figure density, vertical/RTL writing, and image-only pages.

On phones, a newly opened text-heavy PDF defaults to reflow after enough content is available to establish acceptable confidence. Complex magazines, forms, comics, sheet music, and low-confidence pages remain in fixed layout with a clear recommendation. The user can override the mode per document at any time. Reflow includes a compact “original page” action and an inline ambiguity marker only where the source mapping is uncertain.

Fixed layout receives practical KOReader-style alternatives implemented with the existing PDF.js surface: fit width, fit page, crop/zoom to detected content bounds, landscape-friendly behavior, and optional column traversal. Reflow and fixed layout share page/progress navigation and source anchors.

### 4. OCR is page-incremental and never blocks the whole book

When a page lacks usable text, the reader offers or automatically schedules OCR according to user settings. It uses the configured local/native OCR path, renders only the required page at a bounded DPI, reports queued/processing/ready/error state, supports cancellation, and stores OCR blocks with page rectangles and confidence in the same reflow schema. The current page and adjacent pages are prioritized; users can begin reading before the entire document completes.

Automatic OCR is opt-in for expensive whole-document work and respects battery/background constraints. Language selection defaults from document metadata/app locale and can be corrected. Failed OCR leaves original-page reading available and provides retry guidance.

Alternatives considered:

- **OCR the whole file during import:** rejected because it delays import, consumes battery/storage, and makes a single failure block reading.
- **Treat OCR text as unanchored plain text:** rejected because annotations and original-page inspection would become unreliable.

### 5. One mobile reader state machine coordinates modes and continuity

Add a mobile PDF reader controller with explicit states for source resolution, opening, password required, analyzing, readable, partially reflowed, OCR processing, recoverable error, and terminal error. It prevents worker fallback errors from masking source failures and maps internal errors to specific recovery actions.

The mobile UI uses an immersive reading surface with tap-toggle safe-area-aware chrome, a bottom sheet for mode and typography controls, a TOC/page scrubber, search, and 44px minimum targets. Reflow preferences include font family/size, line height, margins, theme, alignment, and image scaling. Fixed-layout preferences include fit/crop/column mode. Settings apply immediately and persist per document with global defaults.

Position is stored as a format-independent source anchor: document fingerprint, source page, optional block ID/text quote/rect, and intra-block offset. Switching modes resolves the closest source anchor, so the reader stays at the same passage. Existing page-only PDF positions remain valid and are upgraded lazily.

### 6. Preserve existing learning workflows through source anchors

Reflow selection produces the same logical PDF selection context used elsewhere: selected text, source pages, PDF rectangles/token data where available, and reflow block IDs. Existing PDF highlights are projected into reflow when anchors can be resolved; ambiguous items remain available in fixed layout and are visibly identified rather than silently misplaced. Search results, assistant quotations, and extracts navigate through the shared anchor resolver.

This favors correctness over visual approximation: content without a confident source mapping can be read, but source-dependent actions explain the limitation.

### 7. Instrument performance and failures without capturing document content

Record local diagnostics for source strategy, file size bucket, time to first page, time to first reflow content, range count/bytes, analysis classification, OCR state, and normalized error category. Do not log paths, extracted text, filenames, or page images. A copyable diagnostic summary is available from the recovery UI.

Target budgets for representative devices are: visible opening feedback within 100 ms, first fixed-layout page or cached reflow content within 2 seconds for a typical local text PDF, bounded range chunks (initially 256 KiB, tunable), and no whole-document WebView allocation for files above the safe threshold. Device benchmarks determine final thresholds.

## Risks / Trade-offs

- **[Tauri IPC may serialize binary ranges inefficiently on some mobile runtimes]** → Benchmark the bridge, keep chunks bounded, prefetch adjacent ranges, and retain a small-file byte fallback; evaluate a narrowly scoped custom mobile plugin only if measured performance requires it.
- **[PDF reading order is inherently ambiguous]** → Use geometry-aware analysis, expose confidence, preserve original view, and never claim semantic fidelity on low-confidence pages.
- **[OCR is slow, battery-intensive, and language-dependent]** → Prioritize visible pages, cap DPI/concurrency, support cancellation, respect battery settings, cache results, and retain fixed layout.
- **[Reflow caches consume storage or become stale]** → Key by source identity plus schema/engine version, store per-page chunks, expose cache size controls, and evict with an LRU policy without touching source PDFs or annotations.
- **[Mode switching can drift from the user's passage]** → Use source anchors and quote-based fallback resolution; add round-trip tests across reflow/fixed modes.
- **[Existing highlights may not map into reflow]** → Preserve them unchanged, show them in fixed layout, and render in reflow only when the mapping is confident.
- **[Encrypted or malformed PDFs have divergent library behavior]** → Surface typed password/unsupported/corrupt states, limit retries, and never fall back to opaque fetch messages.
- **[Scope can expand into a general document-layout engine]** → Deliver in vertical slices: source reliability, text-PDF reflow, mobile UX/continuity, then OCR and advanced fixed-layout aids.

## Migration Plan

1. Add typed native metadata/range commands and `NativePdfRangeTransport` behind a mobile PDF source feature flag; retain the current source path for rollback.
2. Enable range transport for internal/device testing, compare load/error/performance diagnostics, then make it the mobile default while retaining bounded small-file fallback.
3. Add the versioned reflow schema, cache, analysis pipeline, and read-only reflow mode behind a separate flag. No existing document rows or annotations are rewritten.
4. Add source-anchor navigation, selection/highlight projection, search, assistant context, and per-document preferences; enable reflow by default only for `semantic` documents.
5. Add incremental OCR and advanced fixed-layout aids after the text-PDF path passes device QA.
6. Remove the asset-URL mobile source only after Android/iOS regression coverage demonstrates the replacement; rollback consists of disabling the source/reflow flags and ignoring additive caches.

## Open Questions

- Which Android/iOS device classes define the final small-file fallback threshold and range chunk/concurrency defaults?
- Should automatic background OCR default to Wi-Fi/charging only, or remain fully manual until device telemetry is available?
- Is a future native layout engine justified for complex scientific tables/equations after the PDF.js geometry analyzer is measured against the test corpus?

