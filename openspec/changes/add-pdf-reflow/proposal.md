# Proposal: add-pdf-reflow

## Why

Fixed-layout PDFs are a poor reading experience on phone screens and narrow desktop panes, and Incrementum's PDF text pipeline is not exact: selections come from DOM ranges over the pdf.js text layer (`buildPdfSelectionContext`, `PDFViewer.tsx:2222`), highlights/extracts inherit imprecise per-line rectangles, search and TTS read flattened `getTextContent()` strings that lose geometry and reading order, and multi-column documents read out of order. Incrementum is an incremental-reading app — exact extraction is core, not cosmetic.

A first step already exists: the unarchived `overhaul-mobile-pdf-experience` change shipped a phone-only, default-off (`semanticReflow: false` in `pdfFeatureFlags.ts`) reflow built purely from pdf.js text-item geometry (`pdfReflowAnalyzer.ts`), with a lazy scheduler, IndexedDB + native page caches, and an OCR fallback. It has no rendered-bitmap visual analysis, is block-level (no word-level anchoring), is phone-only, and its native cache is write-only. This change turns that prototype into a cross-platform system with a canonical, Rust-owned content model that both the Original and Reflow views — and every downstream consumer (selection, highlights, extracts, TTS, search, AI context) — share as the single source of truth.

## What Changes

- Add a **canonical PDF content model** in Rust: per-page words (with source bboxes, stable IDs, reading order, provenance), lines, paragraphs, and typed reflow blocks (heading / paragraph / list / figure / table / equation / code / quote / caption / footnote / header / footer / page-number), each retaining source regions and confidence.
- Add a **hybrid page-analysis pipeline**: the rendered page bitmap (produced by the existing pdf.js renderer at analysis resolution) provides visual organization (margins, whitespace gutters, columns, ink regions); native pdf.js text items provide exact content. Rust performs the analysis; no LLM, no cloud, no re-OCR of born-digital text.
- Implement **KOReader/k2pdfopt-inspired reflow independently** (no GPL code): content-bounds detection, column detection via whitespace, reading order from geometry, paragraph reconstruction with conservative de-hyphenation, recurring header/footer suppression, and a bitmap graphical-word fallback that packs region crops when semantic reconstruction fails.
- Make **exact selection first-class**: a canonical selection representation (word-ID based) that both views resolve into; Original-mode selections snap to canonical words instead of trusting DOM text-layer geometry; Reflow-mode selections map DOM ranges to canonical word IDs.
- Make **Reflow a first-class viewing mode on all platforms** (Linux, macOS, Windows, Android; architecture does not preclude iOS) with responsive typography settings, figure/equation/table handling, and an Original/Reflow toggle that preserves logical reading position in both directions.
- Store **exact provenance on extracts/highlights** (word IDs + source rectangles per page) enabling "View in original PDF" and "View in reflow" round-trips; TTS, search, and AI context operate on canonical reading order instead of flattened text-layer strings.
- Add **pluggable OCR** for scanned pages (reusing the existing OCR provider architecture and Android AICore OCR where available), with confidence + bounding boxes retained, plus the graphical fallback so scanned PDFs stay readable even without OCR.
- Add **persistent versioned caching** keyed on document fingerprint + engine/schema versions (fixing the currently write-only native cache), with lazy around-the-reader processing so a 700-page book opens without upfront conversion.
- Add a **layout debug overlay** (columns, blocks, reading order, confidence) and observability counters.
- Supersede the phone-only prototype: schema/engine version bump invalidates old caches; the desktop and mobile viewers share one renderer.

Non-goals: recreating figures/equations with AI, semantic table reconstruction when confidence is low (crop fallback instead), cloud conversion, EPUB reader changes, and full RTL/Bidi support beyond preserving existing behavior.

## Capabilities

### New Capabilities

- `pdf-canonical-content-model`: The Rust-owned canonical PDF page model — hybrid bitmap+native-text analysis, word/line/paragraph/block extraction with stable IDs, source coordinates, reading order, confidence, header/footer roles, conservative de-hyphenation; lazy around-the-reader scheduling; versioned persistent cache with invalidation.
- `pdf-reflow-reading`: The cross-platform Reflow view — responsive rendering of canonical blocks as real selectable text, figure/equation/table strategies (including crop fallbacks and table render modes), graphical fallback reflow, typography settings, and bidirectional Original/Reflow position sync on desktop and mobile.
- `pdf-exact-selection`: Canonical word-level selection shared by Original and Reflow views — selection snapping, exact highlight/extract provenance with source rectangles and word IDs, round-trip navigation between views, and canonical-text feeds for TTS reading order, search, and AI context.
- `pdf-scanned-fallback`: Handling for scanned and unanalyzable pages — page classification (native/scanned/mixed), pluggable local OCR with confidence and boxes, and bitmap graphical reflow so no page becomes unreadable.

### Modified Capabilities

(none — existing specs such as `exact-search-hit-navigation` already state anchor requirements generically; this change satisfies them more precisely without changing their requirements.)

## Impact

- **Frontend**: `src/components/viewer/PDFViewer.tsx` (mode toggle un-gated from phone, canonical selection wiring), `PdfReflowRenderer.tsx` (block renderer extension), `pdfReflowScheduler.ts` (Rust-backed analysis calls), `pdfTextSelection.ts` / `pdfSelectionPersistence.ts` (canonical snapping), `pdfAnchorResolver.ts` (word-level anchors), `pdfReflowCache.ts` (native cache reads), search/TTS context paths, `settingsStore.ts` (reflow settings), new `src/api/pdfReflow*.ts` wrappers, new `src/lib/pdf/` coordinate-transform module.
- **Rust**: new `src-tauri/src/pdf/` module (model, analysis, coordinates, cache), new `src-tauri/src/commands/pdf_reflow.rs` analysis/persistence commands (replacing `pdf_reflow_cache.rs` opaque-value commands), `lib.rs` handler registration; reuses `pdf_mobile.rs` identity/fingerprint utilities and the `pdf-reflow-v1` cache layout pattern (bumped to `pdf-reflow-v2`).
- **Dependencies**: no new runtime crates for the standard path (analysis is pure computation over the existing `image` crate and JSON inputs); optional dev-only Playwright for visual regression tests; no GPL dependencies (KOReader/k2pdfopt are inspiration only; algorithms implemented independently).
- **Storage/migration**: reflow cache directory version bump (old cache invalidated harmlessly); extracts' `selection_context` JSON extended additively (word IDs, canonical block IDs) with v1 payloads still renderable; `documents.position_json` / `ViewState.pdfAnchor` extended with word-level anchor alongside existing block/textQuote anchors.
- **Tests**: new fixture corpus (synthetic PDFs in `src-tauri/tests/fixtures/` + `scripts/memory-bench/fixtures`), Rust unit tests for analysis, exactness tests (round-trip selection/extract), vitest suites for selection mapping and renderer, `src/**/*.bench.ts` entries for scheduler/renderer hot paths, visual-regression screenshots at common viewports.
- **Users**: Reflow becomes available on desktop (flag-gated rollout), stays optional; Original view gains more precise selection; existing highlights/extracts keep working.
