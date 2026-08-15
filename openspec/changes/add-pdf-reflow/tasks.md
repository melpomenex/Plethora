# Tasks: add-pdf-reflow

## 1. Foundations — canonical model, coordinates, cache v2 (Rust)

- [x] 1.1 Create `src-tauri/src/pdf/` module skeleton (`mod.rs`, `model.rs`, `coordinates.rs`) with the canonical serde types (schema v2, engine `rust-hybrid-v2`): `PdfCanonicalWord/Line/Paragraph/Block/Page`, block kinds + roles, provenance fields; register the module in `lib.rs`
- [x] 1.2 Implement `coordinates.rs`: `PdfRect`, `RasterRect`, `NormalizedRect` with named transforms (PDF↔raster↔normalized↔) and round-trip unit tests
- [x] 1.3 Create TS mirror types in `src/types/pdfCanonical.ts` (matching serde output) and a parity test asserting TS/Rust field names against a golden JSON fixture
- [x] 1.4 Implement `cache.rs` v2 layout (`pdf-reflow-v2/{sha256(documentId)}/{sha256(identity|schema|engine)}/page-N.json` + `assets/`), 128 MiB LRU eviction, atomic writes — porting and absorbing `pdf_reflow_cache.rs`; keep v1 commands intact until phase 10
- [x] 1.5 Add commands in new `src-tauri/src/commands/pdf_reflow.rs`: `pdf_reflow_get_page`, `pdf_reflow_put_page`, `pdf_reflow_put_asset`/`pdf_reflow_get_asset` (raw `tauri::ipc::Response` bytes), `pdf_reflow_delete_cache`; register in `lib.rs` invoke handler; add `src/api/pdfReflow.ts` wrappers
- [x] 1.6 Wire the frontend cache layer (`pdfReflowCache.ts`) to read native v2 first (fixing the write-only native cache bug), IndexedDB as session warm layer

## 2. Hybrid analysis pipeline — single-column native text

- [ ] 2.1 Implement `analysis/raster.rs`: PNG decode → grayscale → binarized ink mask + downscaled row/column projection profiles; unit tests on synthetic bitmaps
- [ ] 2.2 Implement word extraction from pdf.js text items (`disableCombineTextItems: true`): whitespace split, per-word bbox interpolation along item transform, `bboxExact` flag, `dir` preservation; unit tests on item fixtures
- [ ] 2.3 Implement `analysis/content_bounds.rs` (margin/content trim from ink mask) and `analysis/rows.rs` (baseline banding from word geometry cross-checked with raster row evidence)
- [ ] 2.4 Implement `analysis/paragraphs.rs`: paragraph merge signals (leading gaps, indentation, font size/weight, punctuation) and conservative de-hyphenation with provenance; deterministic unit tests incl. hyphenated/multi-page-paragraph fixtures
- [ ] 2.5 Implement `analysis/blocks.rs` block typing for text blocks (heading/paragraph/list/code/quote) and `analysis/reading_order.rs` single-region ordering
- [ ] 2.6 Add `pdf_reflow_analyze_page` command (raw-bytes raster + JSON items input → canonical page JSON, `spawn_blocking`, bounded concurrency 1, 10 s timeout per `processor/pdf.rs` pattern)
- [ ] 2.7 Frontend raster/text-item collector: render analysis-res grayscale PNG via existing pdf.js canvas path (~110–130 dpi, bounded edge) + gather text items; feed the scheduler
- [ ] 2.8 Golden-fixture exactness tests: for corpus fixtures (single-column, ligatures, unusual Unicode), assert canonical text == expected text, IDs deterministic across runs

## 3. Exact selection — Original view first

- [ ] 3.1 Implement `selection.rs`: `resolveSelection(pageRects) → {startWordId, endWordId, text, pageRegions}` with word-level snapping, and `selectionRects(selection) → per-page rects`; unit tests incl. the "brown fox jumps" exactness case
- [ ] 3.2 Add `pdf_reflow_resolve_selection` command + `src/api` wrapper; extend `buildPdfSelectionContext` to attach canonical resolution when the page model is available
- [ ] 3.3 Gate behind `canonicalPdfModel` flag in `pdfFeatureFlags.ts` (default off, override key + legacy fallback to current text-layer behavior)
- [ ] 3.4 Extend `PersistedSelectionContext` v2: additive `canonical` layer (word IDs, block IDs, page regions) written by highlight/extract creation; `persistedDocumentHighlights` prefers canonical regions, legacy `pdfRects` still render (migration test with a pre-change payload)
- [ ] 3.5 Migrate ad-hoc `viewport.convertToPdfPoint`/`convertToViewportRectangle` call sites in the PDF viewer into `src/lib/pdf/coordinates.ts` (single transform module) with round-trip tests (seeded PRNG)

## 4. Basic Reflow view — cross-platform

- [ ] 4.1 Build the v2 reflow renderer on `PdfReflowRenderer.tsx`: render canonical blocks as semantic HTML with real selectable text, word-ID spans (`data-w`) inside paragraphs, page sections with lazy mounting
- [ ] 4.2 Remove the phone-only gate (`isPhone &&` in `PDFViewer.tsx` reflow effect) behind `semanticReflow`; add the `Original | Reflow` segmented toggle to the toolbar on all form factors
- [ ] 4.3 Reflow selection: map DOM ranges to `data-w` spans → canonical selection; wire popup actions (highlight/copy/extract) to canonical payloads via the §3 representation
- [ ] 4.4 Responsive typography: expose shared reflow settings (font size, line height, margins, reader font, dark/e-ink themes) from `settingsStore.ts` `PDFSettings` on desktop and mobile; re-layout must not re-run analysis (test)
- [ ] 4.5 Position sync: extend `PdfSourceAnchorState` with `wordId` (resolver order wordId → blockId → textQuote → rect) in `pdfAnchorResolver.ts`; implement both toggle directions incl. restore-after-reload tests
- [ ] 4.6 Un-analyzed/failed page handling: minimal progress state, original-page fallback rendering; never blank

## 5. Visual analysis — columns, headers/footers, reading order

- [ ] 5.1 Implement `analysis/columns.rs`: column-projection gutter detection, recursive whitespace segmentation (XY-cut style), region tree with full-width span promotion; assignment of native words to regions by bbox overlap
- [ ] 5.2 Implement multi-region `reading_order.rs`: top-to-bottom, left-to-right per `dir`, spanning elements promoted; two- and three-column fixture exactness tests (column order, not PDF text order)
- [ ] 5.3 Implement `analysis/headers_footers.rs`: cross-page recurrence detection (fuzzy match over analyzed page batch), roles `header|footer|page-number`, suppression flag for reflow rendering only
- [ ] 5.4 Handle rotated pages, odd page sizes, and large-margin pages via content-bounds normalization (fixtures 10–12)
- [ ] 5.5 Footnote detection and ordering (bottom-of-region small-type blocks → `footnote` kind, ordered after body per settings default)

## 6. Figures, equations, tables

- [ ] 6.1 Ink-cluster detection for non-text regions (`figures.rs`): clusters with no native-text overlap → `figure` blocks; caption attachment via adjacency + "Figure N" pattern
- [ ] 6.2 Asset pipeline: on-demand hi-res source-region render → `pdf_reflow_put_asset` → cache-dir storage by sha256; fullscreen zoomable viewer + source-page navigation
- [ ] 6.3 `equations.rs`: math-signal detection (glyph density, font changes, operator/arrow chars); equation blocks render as source crops by default, native glyphs retained as altText for search/TTS/AI
- [ ] 6.4 `tables.rs`: ruling-line/aligned-grid detection; structural row/cell parse gated on confidence; render modes fit / horizontal-scroll / cards (opt-in) / original crop with complexity-based default; wide-table fixture tests
- [ ] 6.5 Low-confidence/unknown regions → `unknown-visual` blocks rendered as exact crops (nothing silently dropped)

## 7. Scanned PDFs — OCR + graphical fallback

- [ ] 7.1 Page classification native/scanned/mixed from text-coverage vs ink-coverage; `ocr-required` state reuses existing `PdfReflowPage` states
- [ ] 7.2 Define `PdfOcrEngine` trait (`recognize(image) → Vec<OcrWord{text, bbox, confidence}>`) in `ocr.rs` and route: existing desktop provider architecture (`src/ocr/`, `commands/ocr_runtime.rs`), browser `performOCRWithProgress` fallback
- [ ] 7.3 Android on-device engine via the android-genai direct bridge pattern (`ondevice_ai_ocr_labels`), capability-gated; replace `pdfReflowOcr.ts` page-level flow with per-region canonical OCR words (`source: "ocr"`)
- [ ] 7.4 OCR words enter the canonical model with confidence; below-threshold regions degrade to crops with altText retained (search/TTS still see the text)
- [ ] 7.5 Implement `fallback/graphical.rs`: row detection → word/phrase region split → packed crop plan for destination width; client-side crop rendering inline; scanned fixture readable with OCR disabled (test)
- [ ] 7.6 Full degradation ladder test: native → mixed → ocr → graphical → original-page fallback, no blank/error states

## 8. Downstream integration — one canonical feed

- [ ] 8.1 TTS: context window assembly from canonical blocks in reading order (replace flattened `getTextContent()` joins where models exist); wire the currently-unwired `ttsQuery`/`ttsHighlightEnabled` highlighting using canonical word spans (Reflow) / rect painting (Original)
- [ ] 8.2 Search: run against per-page canonical text with results carrying `{pageIndices, wordIds}`; navigation paints hits in either view; legacy text fallback for unanalyzed ranges
- [ ] 8.3 AI context: assistant context assembly uses canonical block neighborhoods (current/prev/next, heading, captions) where available
- [ ] 8.4 Extract provenance round-trips: "View in original PDF" (page scroll + region indication) and "View in reflow" (block scroll) from stored word IDs, surviving reload (tests)
- [ ] 8.5 Debug overlay + observability: developer overlay (bounds, columns, blocks, order numbers, confidence), page-model JSON export, non-sensitive diagnostics (analysis ms, columns, blocks, fallback/cache flags) via existing diagnostics plumbing

## 9. Performance, mobile, rollout

- [ ] 9.1 Tune scheduler window (`+5/−2` starting point) and raster resolution from measurements; keep analysis off the UI thread and idle-yielded; Android battery defaults (no background full-document sweep)
- [ ] 9.2 Memory bounds: hold models only for the reading window; extend `scripts/memory-bench` with a reflow scenario and record results
- [ ] 9.3 Add `src/**/*.bench.ts` entries (seeded PRNG, no Tauri runtime) for coordinate transforms, anchor resolution, scheduler ordering, renderer block layout; record baselines in `scripts/perf-baselines.json` per AGENTS.md protocol
- [ ] 9.4 Provisional targets measured and recorded on reference hardware: first reflowed page ≤ 1.5 s, per-page analysis ≤ 150 ms warm; adjust from evidence, then gate at 1.25×
- [ ] 9.5 Rollout: flip `canonicalPdfModel` and `semanticReflow` defaults per platform after gates pass; keep override keys + one-cycle legacy retention per `nativePdfRangeSource` precedent
- [ ] 9.6 Licensing documentation: note independent implementation (no KOReader/k2pdfopt GPL code) and dependency licenses (existing crates MIT/Apache-2.0; Playwright dev-only Apache-2.0) in README/THIRD-PARTY notes

## 10. Tests, visual regression, cleanup

- [ ] 10.1 Build the 20-category synthetic fixture corpus (`src-tauri/tests/fixtures/pdf-reflow/` + checked-in generator script) with expected-model JSON for exactness suites
- [ ] 10.2 Visual regression: dev-only Playwright setup, `test:visual` script screenshotting Original/Reflow of representative fixtures at 360×800, 390×844, 412×915, 768×1024, desktop narrow/large; CI warn-only initially
- [ ] 10.3 Regression sweep: existing PDF suites (`fix-pdf-selection-*`, `pdfTextSelection`, `pdfSelectionPersistence`, `pdfAnchorResolver`, navigation stability), EPUB viewer suites, and non-PDF readers unchanged
- [ ] 10.4 Bundle gate: `npm run bench:check` + bundle budget pass (`pdfWorkerAssetCount` stays 1); update `scripts/bundle-budgets.json` only with justification
- [ ] 10.5 Remove the v1 prototype one release after v2 defaults on: `pdfReflowAnalyzer.ts`, v1 IndexedDB cache, `pdf_reflow_cache.rs` v1 commands, `pdf-reflow-v1` dir cleanup command
- [ ] 10.6 Manual smoke checklist on Linux/macOS/Windows/Android: open 700-page book → Reflow at current page → resize/rotate → toggle views → select/highlight/extract → TTS/search → View-source round trip → scanned PDF path
