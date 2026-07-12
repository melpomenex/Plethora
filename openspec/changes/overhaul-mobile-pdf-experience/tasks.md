## 1. Test corpus, feature flags, and diagnostics

- [x] 1.1 Add representative PDF fixtures or documented local fixtures for single-column text, multi-column academic text, tables/figures, RTL text, scanned pages, mixed text/scans, encrypted files, malformed files, and large files.
- [x] 1.2 Add independent feature flags for the native mobile PDF range source and semantic reflow, with the existing reader retained as a rollback path during rollout.
- [x] 1.3 Define normalized PDF source, parsing, password, analysis, OCR, and cache error types shared between the native API and reader controller.
- [x] 1.4 Add privacy-safe PDF diagnostics for source strategy, size bucket, range activity, time to first page/reflow, classification, and normalized failure category.

## 2. Secure native mobile range source

- [x] 2.1 Add a native command that resolves an authorized document PDF and returns size, modification identity, lightweight fingerprint, and range capability without exposing unrelated paths.
- [x] 2.2 Add a native bounded range-read command with canonical-path authorization, range validation, maximum chunk enforcement, exact byte semantics, and typed stale-file errors.
- [x] 2.3 Add Rust tests for valid, end-of-file, empty, overlapping, oversized, unauthorized, path-traversal, missing, and changed-file range requests.
- [x] 2.4 Implement `NativePdfRangeTransport` over PDF.js `PDFDataRangeTransport`, including initial bytes, request coalescing, bounded concurrency, small range caching, cancellation, and stale-viewer guards.
- [x] 2.5 Refactor PDF source selection so native mobile prefers range transport, desktop/web retain their supported data/URL sources, and only verified small files may use a bounded whole-file fallback.
- [x] 2.6 Separate source failures from PDF worker failures so clearing/retrying the worker cannot mask a missing or unreadable native source.
- [x] 2.7 Add frontend tests for source selection, range delivery, repeated/overlapping requests, cancellation on document switch, worker retry, and prevention of whole-file mobile allocation.

## 3. Mobile PDF opening and recovery states

- [x] 3.1 Implement a mobile PDF reader state machine covering source resolution, opening, password required, analyzing, readable, partially reflowed, OCR processing, recoverable error, and terminal error.
- [x] 3.2 Add a secure password prompt wired to PDF.js password callbacks with distinct required-password and incorrect-password states.
- [x] 3.3 Replace raw `Failed to fetch`/generic load output with missing-or-unsynced, unauthorized, changed, encrypted, corrupt, unsupported, and resource-limit recovery screens.
- [x] 3.4 Add retry, download/locate, open-original/external, and copy-diagnostics actions only when each action is valid for the current failure.
- [x] 3.5 Add tests proving a locally available mobile PDF does not require WebView fetch and each normalized error renders the correct recovery actions.

## 4. Versioned semantic reflow model and cache

- [x] 4.1 Define versioned `PdfReflowDocument`, page analysis, block, source-anchor, extraction-method, confidence, language/direction, and processing-state types with serialization tests.
- [x] 4.2 Add native per-document/per-page cache commands keyed by source identity plus schema/engine version, with atomic writes, partial completion, invalidation, and LRU eviction.
- [x] 4.3 Add an IndexedDB or in-memory cache adapter implementing the same contract for browser/PWA mode.
- [x] 4.4 Implement safe block rendering through React components for headings, paragraphs, lists, tables, figures/captions, links, footnotes, equations/code-like content, and page boundaries.
- [x] 4.5 Sanitize extracted links/content, preserve Unicode and RTL direction, and add accessibility semantics and tests for script-like text and unsafe URIs.

## 5. Text PDF analysis and incremental reflow

- [x] 5.1 Extract PDF.js text items, styles, links, and geometry per page independently of mounted text layers, preserving PDF coordinates and token identity.
- [x] 5.2 Implement geometry-aware line and block grouping with whitespace normalization while retaining source token/rectangle mappings.
- [x] 5.3 Implement conservative column ordering plus repeated header/footer, paragraph, heading, list, table, figure/caption, footnote, and page-boundary detection.
- [x] 5.4 Implement page/document quality classification for semantic, semantic-with-warnings, OCR-required, and fixed-layout-recommended outcomes using recorded signals.
- [x] 5.5 Build an incremental scheduler that prioritizes the current and adjacent pages, processes outward during idle time, publishes partial results, and cancels on document change.
- [x] 5.6 Refactor compatible pieces of the existing Rust PDF-to-HTML converter to consume/render the semantic model or clearly isolate it as a legacy export path.
- [x] 5.7 Add deterministic analyzer tests for the text, multi-column, repeated-header/footer, table, figure, and RTL fixtures, including confidence and source-anchor assertions.

## 6. Incremental OCR reflow

- [x] 6.1 Detect text-poor pages and expose per-page OCR eligibility without forcing whole-document OCR during import or open.
- [x] 6.2 Render OCR input at bounded DPI and integrate the configured local/native OCR provider with language/direction settings and current-page priority.
- [x] 6.3 Convert OCR results into semantic blocks with confidence and source rectangles, and persist successful pages through the reflow cache.
- [x] 6.4 Add queued, processing, ready, low-confidence, cancelled, and failed OCR UI states while keeping original-page reading available.
- [x] 6.5 Add cancellation, concurrency, battery/background constraints, cache reuse, retry, and cleanup tests for mixed and fully scanned PDFs.

## 7. Mobile reflow reading surface

- [x] 7.1 Add a phone-only reflow surface in `DocumentViewer`/the PDF reader that streams semantic pages into one responsive column with no horizontal overflow.
- [x] 7.2 Add safe-area-aware immersive chrome with tap-to-toggle behavior, 44px controls, a compact progress indicator, and gesture arbitration that yields to text selection.
- [x] 7.3 Add a bottom sheet for reflow typography, margins, line height, theme, image scaling, direction, and mode controls with immediate position-stable updates.
- [x] 7.4 Persist global PDF defaults and per-document overrides for preferred mode and reflow/fixed-layout preferences.
- [x] 7.5 Default semantic PDFs to reflow on phones, keep low-confidence/complex PDFs in fixed layout, and expose per-page warnings or processing placeholders without blocking the rest of the document.
- [x] 7.6 Add “view original page” actions on reflow blocks and uncertainty messaging where precise source geometry is unavailable.
- [ ] 7.7 Add responsive and interaction tests at small, regular, and large phone widths, including safe areas, orientation changes, dynamic font scaling, and selection near tap zones.

## 8. Fixed-layout mobile modes and shared navigation

- [x] 8.1 Polish the existing PDF.js mobile surface for fit-width, fit-page, crop-to-detected-content, pinch zoom, and landscape behavior without accidental horizontal traps.
- [x] 8.2 Add optional column traversal for compatible multi-column fixed layouts with configurable flow direction and overlap.
- [x] 8.3 Implement shared source-anchor resolution between reflow blocks and fixed-layout page/rectangle positions.
- [x] 8.4 Wire the PDF outline, page/section scrubber, progress, and search results through the shared resolver with original-page fallback.
- [ ] 8.5 Add round-trip tests for reflow-to-fixed-to-reflow mode switching, outline navigation, search navigation, zoom/crop changes, and pages still awaiting reflow.

## 9. Position, highlights, extracts, and assistant context

- [x] 9.1 Extend PDF reader-position serialization with fingerprint, source page, optional block/text quote/rectangle, and intra-block offset while retaining legacy page-only compatibility.
- [x] 9.2 Restore source-aware positions after restart and lazily upgrade legacy positions without jumping users when background reflow completes.
- [x] 9.3 Produce existing logical PDF selection context from reflow selections, including pages, block IDs, rectangles/token data when available, and explicit mapping confidence.
- [x] 9.4 Project existing PDF highlights into reflow only when anchors resolve confidently, preserving ambiguous annotations in fixed layout without misplacement.
- [x] 9.5 Route extract return-to-source, assistant quotations/citations, and search emphasis through the shared PDF anchor resolver.
- [ ] 9.6 Add integration tests for creating and reopening highlights/extracts in both modes, ambiguous mappings, assistant context, legacy annotations, and cross-mode position continuity.

## 10. Performance, device QA, and rollout

- [ ] 10.1 Add benchmarks for range IPC throughput, peak WebView memory, time to first page, time to first reflow content, analyzer throughput, OCR latency, and cache size on representative Android and iOS devices.
- [ ] 10.2 Tune initial range size, maximum chunk size, concurrency, prefetch, safe whole-file threshold, OCR DPI, and cache limits from benchmark results and document the selected budgets.
- [ ] 10.3 Verify offline behavior and run end-to-end device QA across every corpus category, app restart/session restore, rapid document switching, background/foreground, low-memory conditions, and orientation changes.
- [ ] 10.4 Verify accessibility with screen readers, dynamic text sizes, focus order, touch targets, contrast, and RTL content in both reading modes.
- [ ] 10.5 Roll out the native range source first, then semantic reflow for high-confidence PDFs, then OCR and advanced fixed-layout aids; monitor normalized failures at each gate.
- [ ] 10.6 Remove the native-mobile asset-URL source only after range transport passes Android/iOS regression criteria, while retaining a documented feature-flag rollback for one release cycle.
