# Design: add-pdf-reflow

## Context

Incrementum renders PDFs with pdf.js 5.4 (`PDFViewer.tsx`, `PdfPageView.tsx` hosting pdf.js `PDFPageView`). Text-dependent features today read two ad-hoc sources: the DOM text layer (selection, search marks, TTS marks) and flattened `page.getTextContent()` strings (search text, TTS/AI context window). Neither carries a durable geometry-backed document model, which is why PDF selection/highlighting is approximate and multi-column reading order is wrong.

A reflow prototype already exists from `overhaul-mobile-pdf-experience`: `pdfReflowAnalyzer.ts` (pdf.js text items → tokens → lines → blocks), `pdfReflowScheduler.ts` (idle-time, outward-from-current-page), `PdfReflowRenderer.tsx` (semantic HTML blocks), `pdfReflowOcr.ts` (canvas render → native/browser OCR), and a two-tier cache (IndexedDB + native `pdf-reflow-v1` JSON files in `src-tauri/src/commands/pdf_reflow_cache.rs`). It is phone-only, gated off by default (`semanticReflow: false` in `pdfFeatureFlags.ts`), block-level only (no word anchoring), has no rendered-bitmap visual analysis (cannot see figures, gutters, or ink without text), and the native cache is never read (`createBrowserPdfReflowCache.get` only hits IndexedDB).

Rust side: no PDF rasterizer (only `lopdf` + `pdf-extract` for whole-file text in `processor/pdf.rs`), `image = "0.24"` available, command pattern is `#[tauri::command] async fn …(State<'_, Repository>)` registered in `lib.rs`, raw binary IPC via `tauri::ipc::Response` is an established pattern (`pdf_mobile.rs`). Extracts persist `selection_context` JSON; positions persist as `position_json` (`DocumentPosition`) plus a localStorage `ViewState` with `pdfAnchor` (`PdfSourceAnchorState`, resolved by `pdfAnchorResolver.ts` via blockId → textQuote → rect overlap). Android has a GenAI plugin with OCR labels (`ondevice_ai_ocr_labels`) and structured-output prompting, plus a direct Rust-side entry precedent (`embed_texts_via_app`).

**Key insight:** pdf.js already renders pages to canvas everywhere Incrementum runs (including the OCR path at ≤2400 px). Feeding that existing raster plus pdf.js text items into a Rust analysis core gives us the KOReader-style visual understanding *and* exact native text — with zero new native rendering dependencies.

## Goals / Non-Goals

**Goals:**

- One canonical, versioned PDF content model (words with source bboxes + stable IDs, lines, paragraphs, typed blocks, reading order, confidence, provenance) owned by Rust and shared by Original and Reflow views and all downstream features.
- Hybrid analysis: rendered-page bitmap for visual organization; native pdf.js text items for exact content; no LLM, no cloud, no OCR of born-digital text.
- Word-exact selection in both views; highlights/extracts with full source provenance and round-trip navigation.
- Cross-platform Reflow (Linux/macOS/Windows desktop, Android; iOS not precluded) with responsive typography and content-type strategies (figures/equations/tables) that never sacrifice source fidelity.
- Lazy, cached, resumable processing around the reader's position; a 700-page book opens without upfront conversion.
- Graceful degradation ladder: native text blocks → native text with fallback blocks → OCR text → graphical bitmap reflow → original page. Never a blank page, never silently dropped content.
- Independently implemented algorithms inspired by KOReader/k2pdfopt concepts; no GPL code; permissively licensed dependencies only.

**Non-Goals:**

- AI recreation of figures/equations/tables; LaTeX extraction beyond an optional future enhancement.
- Semantic table reconstruction when confidence is low (crop fallback instead).
- Cloud conversion services or vision-LLM pipelines for standard reflow.
- Changes to the EPUB reader or its CFI machinery.
- Full RTL/Bidi reflow beyond preserving pdf.js `dir` metadata and falling back to fixed-layout recommendation for RTL pages (existing classification already has this path).
- Headless/server-side reflow (Rust rasterization) — architecture leaves room, not scope.

## Decisions

### D1: Hybrid inputs — pdf.js raster + text items in, Rust analysis out

The frontend renders each page once at analysis resolution (grayscale PNG, ~110–130 dpi target, bounded longest edge) via the existing pdf.js canvas path, collects `page.getTextContent({ disableCombineTextItems: true })` items (transform, width, height, str, dir, fontName, hasEOL), and submits both to a new Rust command `pdf_reflow_analyze_page`. Rust performs all layout analysis (pure computation over a bitmap + a word-geometry list) and returns the canonical page model. Raster bytes cross IPC base64-in-JSON (matching the `ocr_image_bytes` precedent — Tauri IPC on Android is JSON-only, raw `tauri::ipc::Request` bodies don't work there; never JSON number arrays), and binary responses (assets) use `tauri::ipc::Response`.

**Decision**: pdf.js remains the only PDF renderer; Rust owns analysis, model, and cache. Analysis becomes deterministic, unit-testable against fixture (bitmap, items) pairs, and identical on desktop/mobile.
**Alternative rejected**: Rust-side rasterization via `pdfium-render` — adds a per-platform native library (desktop frameworks + Android `.so` + future iOS) for capability we already have; revisit only if a headless path is ever needed. Pure-TypeScript analysis (status quo prototype) — not shareable with future Rust consumers, harder to test exhaustively, and keeps two text models alive.

### D2: Canonical model & versioning — Rust `src-tauri/src/pdf/`, schema v2

New top-level Rust module (mirrors how `src/ocr/` and `src/ai_learning/` sit beside `commands/`):

```text
src-tauri/src/pdf/
  mod.rs
  model.rs          # canonical serde types (schema v2)
  coordinates.rs    # rect/point types + explicit transforms
  analysis/
    mod.rs          # analyze_page(inputs) -> CanonicalPage
    raster.rs       # decode PNG, grayscale, downscale, binarize, ink mask
    content_bounds.rs
    columns.rs      # projection profiles, gutter detection, region split
    rows.rs         # line banding from word geometry + raster rows
    paragraphs.rs   # paragraph merge, de-hyphenation
    reading_order.rs
    headers_footers.rs  # cross-page recurrence (needs page batch context)
    blocks.rs       # block typing + figure/table/equation classification
    figures.rs, tables.rs, equations.rs   # per-kind strategies
  fallback/
    graphical.rs    # k2-style row→word-crop packing plan
  ocr.rs            # PdfOcrEngine trait + engine routing
  cache.rs          # v2 page/asset cache (absorbs pdf_reflow_cache.rs)
  selection.rs      # rect→word snapping, range resolution
```

The model extends the existing TS shapes (`pdfReflowTypes.ts`) rather than inventing new vocabulary: `PdfCanonicalWord { id, pageIndex, text, sourceBBox, readingOrder, confidence, source: native_pdf_text | ocr | graphical }`, `PdfCanonicalLine`, `PdfCanonicalParagraph { wordIds, text, sourceRegions }`, `PdfCanonicalBlock` (kinds: existing ten + `quote`, `sidebar`, `hr`, `unknown-visual`; plus `role: body | header | footer | page-number`), `PdfCanonicalPage { state, classification, confidence, textCoverage, blocks, words }`. Version constants bump: `schemaVersion: 2`, `engineVersion: "rust-hybrid-v2"` — old caches simply miss. TS mirrors live in `src/types/pdfCanonical.ts` (single source of truth: Rust structs; a `scripts/` check or test asserts the TS/Rust field parity like existing floor-check scripts).

HTML/React remains a rendering target only; the persisted format is the canonical JSON.

**Decision**: supersedes `pdfReflowAnalyzer.ts` (retained temporarily behind the v1 flag for rollback, then removed); `pdfReflowTypes.ts` types migrate to the canonical v2 names.
**Alternative rejected**: keeping analysis in TS and only caching in Rust — leaves the canonical model unowned, untestable in Rust, and duplicated across platforms.

### D3: Stable IDs and provenance

IDs are deterministic per document fingerprint + page + index so caches, extracts, and anchors stay valid across sessions without a DB sequence: words `p{page}:w{index}`, lines `p{page}:l{index}`, blocks `p{page}:b{index}` (index in *analysis output order*, which is deterministic for fixed engine version). Every block carries `sourceRegions: [{pageIndex, bbox}]` — possibly multiple (multi-region or cross-page content), plus `wordIds`. Every extract/highlight stores `{startWordId, endWordId, wordIds?, blockIds, pageRegions}`. Words keep exact PDF-space bboxes (origin bottom-left, pdf.js `convertToPdfPoint` convention already used).

**Decision**: IDs never depend on viewport, font settings, or re-analysis timing.
**Alternative rejected**: content-hash IDs — unstable under de-hyphenation/whitespace normalization decisions and expensive to keep consistent.

### D4: Coordinate discipline — one module per side

`src-tauri/src/pdf/coordinates.rs` (`PdfRect`, `RasterRect`, `NormalizedRect` + named transforms) and `src/types`-paired `src/lib/pdf/coordinates.ts` are the only places allowed to convert between PDF space, raster space (top-left origin, analysis scale), normalized page space, and CSS/viewport space (existing `pdfRectToViewportRect` moves there). A shared vitest + Rust test suite round-trips random rects through all transforms (seeded PRNG per repo bench rules).

**Decision**: ad-hoc `viewport.convertToPdfPoint` calls outside this module are lint/test-discouraged; existing call sites migrate during Phase 2.
**Alternative rejected**: leaving conversion at call sites (status quo) — this is the root cause class of today's misaligned highlights.

### D5: Visual analysis — ink masks at analysis resolution, coordinates at PDF resolution

`raster.rs` decodes the PNG, converts to grayscale, and builds: (a) a binarized ink mask, (b) 2–4× downscaled row/column projection profiles for speed. From these: content bounds (trim margins), vertical whitespace gutters (column detection via column-projection valleys wider than a gutter threshold relative to median line height), horizontal band segmentation (text rows, gaps), and ink clusters that have no native-text overlap (figures, rules, table grids, equations-as-graphics). Native words are assigned to visual regions by bbox overlap. All downstream math happens in PDF-space coordinates via D4 transforms; the raster is discarded after analysis (never persisted, except user-facing crops — D7).

Recursive XY-cut-style segmentation (alternate horizontal/vertical whitespace splits, deepest-first ordering) determines region tree and reading order: regions ordered top-to-bottom, columns left-to-right (per `dir`), with cross-column spanning regions (wide titles, full-width figures) promoted above the columns they span. Repeated top/bottom strips whose text recurs (fuzzy match) across ≥3 analyzed pages become `role: header | footer | page-number` — suppressed in Reflow rendering, retained in the model and Original view.

**Decision**: heuristic, deterministic, no AI in this path; every classification carries `confidence`; low-confidence regions degrade per D8/D12 rather than guessing.
**Alternative rejected**: trusting pdf.js text order (today's bug); OCR-first analysis (wastes exact text, adds errors); mupdf-style layout library (AGPL or heavy).

### D6: Text reconstruction — words from items, paragraphs from geometry

pdf.js items are split into words on whitespace; per-word bboxes are computed by interpolating along the item's transform direction proportional to per-character advances (item width / char count, refined when `disableCombineTextItems` yields finer fragments). Word boxes are marked `bboxExact: false` when interpolated (they are overlap-accurate, not glyph-exact — sufficient for snapping and highlighting; the persisted *text* is exact regardless). Lines form by baseline banding within a column region (adapting the existing `pdfReflowAnalyzer.ts` banding + gutter-split heuristics, which get ported to Rust and improved with raster row evidence). Paragraphs merge lines using: vertical gap vs. median leading, x-indentation changes, font size/weight, line-end vs. line-start punctuation, column membership. De-hyphenation merges `foo-\nbar` only when the hyphen is line-final, the next line starts lowercase, and the joined token is not a known hyphenated form in a small dictionary heuristic; merged words retain both source bboxes and a `dehyphenated: true` marker so original text is always reconstructible.

**Decision**: conservative, evidence-gated joining; provenance survives every transformation.
**Alternative rejected**: aggressive dictionary de-hyphenation — destructive guessing violates the fidelity-first principle.

### D7: Non-text content — preserve, don't recreate

- **Figures**: ink clusters (or pdf.js-identified image regions, Phase 5+) with no text overlap become `figure` blocks. Asset = high-quality crop of the source region rendered by pdf.js at print resolution (≥2× analysis scale) on demand, uploaded via `put_pdf_reflow_asset` (raw bytes), stored in the cache dir (`assets/<sha256>.png`), referenced by `assetId`. Fullscreen viewer on tap; no interior reflow. Captions attach via adjacency + "Figure N" pattern.
- **Equations**: text-dense regions with math signals (high glyph-density, inline font changes, sparse spacing, operator/arrow characters) become `equation` blocks rendered as source crops by default; native glyph text is retained as `altText` for search/TTS/AI but not rendered as flowing text. `latex` field reserved, empty in this change.
- **Tables**: ruling-line clusters (aligned horizontal/vertical ink runs) or aligned-column text grids become `table` blocks. Structural parse (rows/cells) runs only when ruling lines or column-alignment confidence is high; otherwise the block renders as a crop. Render modes: `fit` (simple tables), `horizontal-scroll` (wide), `cards` (opt-in, row-per-card), `original` (crop) — default chosen by width/complexity, user-overridable per document.

**Decision**: every non-text block is a first-class citizen with an exact source crop; semantic reconstruction is an enhancement that never replaces the source asset.
**Alternative rejected**: embedded-image extraction first — misses vector diagrams/charts and complicates Phase 5; crop-first is uniform and always correct.

### D8: Canonical selection — word IDs are the anchor currency

New Rust module `selection.rs` + TS facade: `resolveSelection(pageRects) → {startWordId, endWordId, text, pageRegions}` (hit-test each rect against word bboxes on analyzed pages, expand to fully-cover partially-hit words — word-level snapping), and `selectionRects(selection) → per-page rects` (union of covered word boxes, per line, for painting). 

- **Original view**: `commitSelection` keeps using DOM ranges only to gather *geometry* (`range.getClientRects()` → page rects via D4); the canonical resolver then produces exact text + word IDs. The DOM text-layer string is no longer authoritative. Popup actions (highlight/copy/extract) consume the canonical result.
- **Reflow view**: paragraphs render words wrapped in word-ID-tagged spans (virtualized per page section; `data-w` attributes). DOM selection maps to the first/last tagged span in the range → canonical selection. Copy/extract/TTS all read canonical text.

`selection_context` JSON gains an additive v2 layer: `canonical: { version: 2, startWordId, endWordId, blockIds, pageRegions }` alongside legacy `pdfRects` (legacy payloads keep rendering via `persistedDocumentHighlights` unchanged; canonical regions take precedence when present).

**Decision**: one selection representation drives highlight, extract, copy, TTS, search-navigation, and AI-context across both views.
**Alternative rejected**: keeping DOM-text-layer text as the extract source (status quo) — this is precisely the inexactness being fixed.

### D9: View toggle & position sync — canonical anchors

`PdfSourceAnchorState` (already persisted in `ViewState`) gains `wordId` as the primary anchor, keeping `blockId`/`textQuote`/rect as fallbacks (resolver order: wordId → blockId → textQuote → rect overlap, extending `pdfAnchorResolver.ts`). Toggle Original→Reflow: anchor = word under the viewport center (or current position anchor) → resolve to block → scrollIntoView. Reflow→Original: anchor → `selectionRects` → page + scroll + transient highlight. Anchors survive reload because IDs are deterministic (D3).

**Decision**: position sync is anchored to canonical content, never to pixel/percent artifacts.
**Alternative rejected**: percent-based mapping — meaningless across layout modes.

### D10: Lazy scheduling & persistent v2 cache

The TS scheduler pattern survives (`pdfReflowScheduler.ts`): priority = current page outward (`pdfPagePriorityOrder`), processing window initially `+5/−2` pages (tunable constant), `requestIdleCallback` yielding, generation-counter cancellation. Per page the scheduler now: (1) checks cache, (2) rasterizes + gathers text items, (3) calls `pdf_reflow_analyze_page`, (4) writes through Rust `put_pdf_reflow_page`. Analysis runs `spawn_blocking` with a bounded worker (one concurrent page analysis; queue in TS) — matching the `spawn_blocking + timeout` pattern in `processor/pdf.rs`.

Cache v2 lives at `app_cache_dir()/incrementum/pdf-reflow-v2/{sha256(documentId)}/{sha256(sourceIdentity|schemaVersion|engineVersion)}/page-N.json` (+ `assets/`), 128 MiB LRU eviction, atomic tmp-rename writes — absorbing `pdf_reflow_cache.rs` (which becomes a thin re-export or is deleted; its commands keep names for the v1 path until removal). **The frontend read path now checks the native cache first** (fixing the write-only bug); IndexedDB becomes a per-session memory warm layer or is dropped for v2.

**Decision**: viewport/font-size changes never re-run analysis — they only re-render from the cached canonical model; cache invalidates exactly on fingerprint, engine, or schema change.
**Alternative rejected**: DB table for page models — file cache + LRU fits regenerable derived data and matches the existing pattern; SQLite stays for extracts/positions.

### D11: Pluggable OCR — trait in Rust, engines stay where they are

`ocr.rs` defines `trait PdfOcrEngine { fn recognize(&self, image: &PageImage) -> Result<Vec<OcrWord>> }` with `OcrWord { text, bbox, confidence }`. Page classification (native-text coverage from text items vs. raster ink coverage) marks pages `scanned | mixed | native`; only scanned/mixed pages (or user-invoked regions) run OCR. Engines: (a) existing provider architecture in `src/ocr/` + `commands/ocr_runtime.rs` (desktop, opt-in runtimes), (b) Android AICore `ondevice_ai_ocr_labels` called via the direct Rust→plugin bridge pattern (`embed_texts_via_app` precedent) when capabilities report OCR available, (c) the existing browser-side `performOCRWithProgress` as a web fallback. OCR words enter the canonical model with `source: "ocr"` and render as real text in Reflow; confidence below threshold degrades the block to graphical fallback (D12) with the OCR text retained as altText.

**Decision**: architecture binds to the trait, never to one engine; no Python/PyTorch requirement anywhere in the base reader.
**Alternative rejected**: a single bundled ONNX engine for all platforms — model size and per-platform runtime maintenance for capability that AICore/Tesseract already provide.

### D12: Graphical fallback reflow — k2-inspired, independently implemented

For regions where neither native text nor OCR yields confident words, `fallback/graphical.rs` produces a *plan* on the raster: detect text rows (horizontal ink bands), split rows into word/phrase sub-regions (vertical whitespace valleys), then specify a packed crop sequence for the destination width (crop list with source rects + target order — the actual pixel crops are cut client-side from an on-demand high-res render and displayed as inline images with correct aspect). Scanned pages thus read with proper line lengths even with zero OCR. The plan and its word-crop rects are part of the canonical page model (`source: "graphical"` pseudo-words with rects but `altText` only).

**Decision**: fidelity-first bitmap reflow is the floor of the degradation ladder, not a separate mode.
**Alternative rejected**: shipping scanned support OCR-only — leaves declined/failed/unsupported-engine documents unreadable in Reflow.

### D13: Downstream integration — canonical feeds replace text-layer scraping

- **TTS**: the context window assembly (`onTextWindowChange`) concatenates canonical block text in reading order (replacing flattened `getTextContent()` joins); the existing unwired `ttsQuery`/`ttsHighlightEnabled` props get connected using canonical word spans (Reflow) / rect painting (Original).
- **Search**: query runs against per-page canonical text (in-memory over analyzed pages, falling back to legacy text for unanalyzed ranges); a match carries `{pageIndices, wordIds}` and renders in either view (Original: rect overlay via D8; Reflow: text-node highlight).
- **AI context**: assistant context assembly prefers the canonical block neighborhood (current/prev/next blocks, heading, captions) over scraped text windows.
- **Extracts**: `createInstantExtract` payload carries the D8 canonical layer; "View source" (pattern from `add-extract-source-return-navigation`) resolves wordIds → Original page+rects or Reflow block scroll.

**Decision**: all four consumers read one model; each keeps its legacy fallback path while pages are unanalyzed.
**Alternative rejected**: per-feature adapters over pdf.js (status quo) — four divergent notions of "the text".

### D14: Rollout — flag-gated, desktop parity from day one

`pdfFeatureFlags.ts` gains `canonicalPdfModel` (Rust analysis + Original-view snapping) and reuses `semanticReflow` (the Reflow *view*), both default-off until their phase gates pass, then flipped per the `nativePdfRangeSource` precedent (override key, one-release-cycle legacy retention). The phone-only gate `isPhone && isPdfFeatureEnabled("semanticReflow")` drops `isPhone` the moment the v2 renderer renders its first desktop page (Phase 3 of tasks). UI: the existing mobile mode toggle becomes a toolbar `Original | Reflow` segmented control present on all form factors; mobile reflow settings in `settingsStore.ts` (`PDFSettings` reflow fields) become shared desktop/mobile settings.

**Decision**: incremental, reversible rollout; no user-visible change until flags flip.
**Alternative rejected**: big-bang replacement of the v1 prototype — forfeits rollback and parallel verification.

### D15: Optional Gemini Nano ambiguity layer — advisor, never authority

When a region's classification confidence < threshold (e.g. 0.5) and the device reports AICore availability, an optional (default-off) step asks the on-device model to classify the region crop into `paragraph | heading | figure | caption | table | equation | sidebar` or to order ambiguous sibling regions — via `ondevice_ai_prompt` with `Structured` output mode and a `response_schema`. Results only *adjust confidence/kind labels*; native text, source regions, and reading order derived from geometry are never overwritten; a hallucination can at worst mislabel a block kind, which crop-fallback rendering makes visually harmless.

**Decision**: strictly additive, measurable-value-gated (enable only if fixture disagreement rate drops), off by default.
**Alternative rejected**: LLM page reconstruction — violates fidelity-first and offline requirements.

### D16: Testing, visual regression, performance gates, licensing

- **Fixture corpus** (`src-tauri/tests/fixtures/pdf-reflow/`, synthetic PDFs generated by a checked-in script so no licensing questions): the 20 categories from the proposal (single-column, 2-col academic, 3-col, textbook w/ figures, math-heavy, complex tables, code-heavy, scanned, mixed, odd sizes, rotated, large margins, footnotes, headers/footers, hyphenated, multi-page paragraphs, ligatures, unusual Unicode, RTL, malformed). Each fixture carries an expected-model JSON for exactness tests.
- **Rust**: unit tests per analysis module on (raster, items) fixtures; exactness assertions `canonical_text == expected`; determinism tests (same input → identical IDs/model). Runs under existing `cargo test --lib`.
- **Vitest**: coordinate round-trips (seeded PRNG), selection snapping (the "brown fox jumps" exactness test), anchor resolution round-trips, renderer structure, scheduler priority/cancellation, cache versioning.
- **Visual regression**: new dev-only Playwright (Apache-2.0) setup with a `test:visual` script screenshotting the Reflow and Original views of representative fixtures at 360×800, 390×844, 412×915, 768×1024, and desktop narrow/large panes; CI job warn-only initially (same posture as the perf gate's early phase). No runtime bundle impact.
- **Performance**: JS benches (`src/**/*.bench.ts`, seeded PRNG, no Tauri runtime) for coordinate transforms, anchor resolution, scheduler ordering, and renderer block layout; Rust-side analysis cost tracked via the memory-bench driver (`scripts/memory-bench`, extended with a reflow scenario) plus logged `page analysis time` diagnostics; provisional targets — first reflowed page ≤1.5 s and per-page analysis ≤150 ms on reference hardware — recorded as baselines in the first implementation PR per the AGENTS.md protocol, then gated at 1.25× via `scripts/perf-baselines.json`; bundle budget unchanged (`pdfWorkerAssetCount` stays 1).
- **Licensing**: no new runtime crates (analysis uses std + existing `image` crate, MIT); Playwright Apache-2.0 dev-only; OCR engines unchanged (existing providers; AICore is a system service); KOReader/k2pdfopt (GPL) contribute *concepts only* — whitespace analysis, region segmentation, row detection, word-box packing — reimplemented from scratch; `THIRD-PARTY`/README licensing notes updated to document this.

**Decision**: exactness and determinism are test-enforced at every layer; performance claims are measured, not assumed.
**Alternative rejected**: screenshot-diff infrastructure in CI from day one — flaky before baselines exist; warn-only first mirrors the perf-gate rollout.

## Risks / Trade-offs

- [Interpolated word bboxes are not glyph-exact] → text is exact regardless; snapping uses overlap with tolerance; D4 tests pin transforms; word boxes marked `bboxExact: false` so consumers can adapt.
- [Heuristic layout analysis misreads exotic pages (rotated spreads, marginalia, multi-lingual)] → confidence gates route to fallback crops; fixture corpus covers 20 categories; degradation ladder guarantees readability; debug overlay (blocks/columns/order/confidence, exported JSON) makes triage tractable.
- [Raster IPC adds per-page cost] → analysis-res grayscale PNGs (~100–300 KB typical), raw-binary IPC, one-page-at-a-time scheduling, cache-once-then-never; measured in Phase 1 baselines before defaults flip.
- [700-page memory pressure] → only the rendered window holds models in memory (existing virtualization precedent); analysis results live in the file cache; LRU cap bounds disk; memory-bench scenario gates regressions.
- [Selection behavior change on Original view] → canonical path is flag-gated; legacy `pdfRects` extraction preserved as fallback; `fix-pdf-selection-*` regression suites keep running.
- [Dual-model transition period (v1 prototype + v2 canonical)] → v1 stays behind its off-by-default flag for one release cycle, then is removed; caches version-invalidate cleanly.
- [Extract `selection_context` schema drift] → additive v2 layer with version field; readers must handle absent `canonical`; migration test asserts legacy payloads render.
- [Android analysis jank] → analysis is `spawn_blocking` off the UI thread; scheduler yields via idle callbacks; window size tunable; battery-conscious defaults (no background full-document processing beyond the opportunistic chapter-ahead window).
- [Playwright adds CI weight] → dev-only, warn-only initially, separate `test:visual` lane; no runtime impact.

## Migration Plan

1. Land Rust `src/pdf/` module + commands + v2 cache with flags off (no user-visible change; `pdf_reflow_cache.rs` still serves v1).
2. Wire Original-view canonical selection snapping behind `canonicalPdfModel` (default off); run fixture + regression suites in both modes.
3. Wire the v2 Reflow renderer behind `semanticReflow` on all platforms (desktop un-gated from phone check); verify against fixtures; flip defaults per platform after perf baselines are recorded.
4. Switch TTS/search/AI-context feeds to canonical sources (legacy fallback retained for unanalyzed pages).
5. Remove the v1 prototype (`pdfReflowAnalyzer.ts`, IndexedDB cache, `pdf-reflow-v1` dir cleanup command) one release after v2 defaults on.
- **Rollback**: every stage reverts by flag flip; v1 code exists until stage 5.

## Open Questions

- Optimal analysis raster resolution and processing window (`+5/−2` starting point) — measure in Phase 1 and record with baselines.
- Should the opportunistic "chapter-ahead" background window exist on battery-constrained Android, or strictly reader-follows? (Default: follows, no background sweep.)
- Table `cards` mode scope: which documents benefit enough to justify the transformation? Ship fit/scroll/original first.
- Whether embedded-image extraction (D7 Phase 5+) justifies `page.getOperatorList()` complexity vs. crop-only.
- iOS: AICore-equivalent OCR unavailable; graphical fallback + future engine slot cover it — confirm when iOS support is scheduled.
