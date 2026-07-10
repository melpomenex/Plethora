## 1. Shared Reader Highlight Palette

- [x] 1.1 Define a canonical translucent palette for yellow, green, blue, pink, purple, and supported extended extract colors in `src/utils/highlightColors.ts`
- [x] 1.2 Update color normalization so semantic names and existing pastel hex aliases resolve to the same reader-safe palette while preserving safe custom-color compatibility
- [x] 1.3 Add unit tests for default fallback, semantic colors, persisted hex aliases, extended colors, and palette alpha/readability constraints

## 2. PDF Highlight Rendering

- [x] 2.1 Update `HighlightLayer` to resolve every saved extract color through the shared reader palette
- [x] 2.2 Remove or align duplicated high-opacity declarations in `PDFViewer.css` and verify the PDF blend/layer treatment does not obscure glyphs
- [x] 2.3 Add focused PDF highlight rendering tests covering default yellow and at least one non-yellow saved color

## 3. EPUB Highlight Rendering

- [x] 3.1 Update persisted epub.js annotations to use the shared reader-safe color resolver with a single, non-multiplied alpha treatment
- [x] 3.2 Add focused EPUB tests asserting annotation fill values for default yellow, semantic colors, and known persisted hex aliases
- [x] 3.3 Confirm search, selection, sync, and navigation highlights retain their independent visual treatments

## 4. Cross-Reader Verification

- [x] 4.1 Run the relevant unit and component test suites and fix any highlight-color regressions
- [x] 4.2 Visually verify existing and newly created extracts in representative PDF and EPUB documents across light and dark reading themes
- [x] 4.3 Verify all supported colors remain distinguishable, readable, and consistent between the PDF and EPUB readers
