## Context

PDF extracts are drawn as positioned overlay rectangles by `HighlightLayer`, using colors exported from `SelectionPopup` and duplicated in `PDFViewer.css`. The default yellow is currently `rgba(255, 235, 59, 0.5)` with `mix-blend-mode: multiply`, which is visibly strong over dark glyphs. EPUB extracts are epub.js SVG annotations whose `fill` comes from `normalizeHighlightColor`; the annotation deliberately uses `fill-opacity: 1`, so the alpha embedded in that normalized color directly determines legibility.

Color names and pastel hex aliases are persisted by existing extract flows. The visual fix must therefore preserve stored values and normalize them only at the rendering boundary. Search, selection, and transient navigation highlights are separate feedback states and are outside the saved-extract palette.

## Goals / Non-Goals

**Goals:**

- Make saved PDF and EPUB highlights clearly visible without obscuring the underlying text.
- Give the same saved color a consistent visual character in both readers.
- Centralize the reader palette so its opacity cannot drift between PDF CSS, PDF inline styles, and EPUB SVG annotations.
- Preserve compatibility with existing semantic names and pastel hex aliases.
- Cover palette normalization and each reader's use of the normalized color with focused tests.

**Non-Goals:**

- Changing the default color from yellow or changing the last-used-color behavior.
- Migrating extract records or changing stored highlight color values.
- Redesigning search-result, current-selection, sync, or navigation-flash highlights.
- Adding user-configurable opacity in this change.

## Decisions

### 1. Define one reader-safe palette in the highlight color utility

Move the canonical rendered colors into `src/utils/highlightColors.ts` and expose a typed resolver for saved reader highlights. Use softer translucent fills (approximately 18–25% alpha, tuned per hue) rather than the current 40–50% fills. Yellow remains recognizable as yellow but uses a warmer, less fluorescent base and lower alpha.

Both semantic values (`yellow`, `green`, `blue`, `pink`, `purple`) and their existing pastel hex aliases resolve to this palette. Additional supported aliases such as orange and red resolve to comparably translucent colors. Unknown valid CSS colors remain supported, but the resolver should avoid silently turning known persisted aliases into opaque overlays.

This central utility is preferred over separate per-viewer constants because PDF and EPUB currently reach the same concept through different rendering mechanisms. A shared resolver makes visual parity testable.

### 2. Make the resolved color authoritative at both rendering boundaries

`HighlightLayer` will resolve the saved color through the shared utility before assigning `backgroundColor`. The duplicated per-color CSS declarations in `PDFViewer.css` will either be removed or changed to non-authoritative fallbacks that use the same tokens; inline and stylesheet values must not compete.

`EPUBViewer` will continue passing the resolved color as the SVG `fill`. It will keep `fill-opacity: 1` because the shared RGBA value already contains the intended alpha; applying a second opacity would make EPUB highlights materially fainter than PDF highlights.

An alternative was to set a single element-level opacity. That was rejected because it can affect interaction/focus decoration and combines unpredictably with epub.js defaults. Encoding alpha in the fill keeps the result explicit.

### 3. Preserve text color and interaction cues

Saved highlights remain overlays behind or over the reader's existing text without replacing the text foreground color. Interactive highlights continue to use pointer and keyboard behavior already provided by `HighlightLayer`; focus/hover affordances may use an outline rather than increasing fill opacity enough to harm readability.

No theme-specific text recoloring is introduced. Translucent fills allow the underlying page or EPUB theme and its text contrast to remain dominant in both light and dark contexts.

### 4. Verify behavior at the palette and viewer integration levels

Unit tests will assert stable normalization for semantic names, stored hex aliases, missing colors, and supported extended colors. Viewer tests will assert that PDF rectangles and EPUB annotation calls receive the shared translucent rendered color, including the default yellow path. Tests should check the palette contract (including alpha below the former 0.5 default), not browser screenshot pixel values.

## Risks / Trade-offs

- **Highlights become too subtle on tinted or image-heavy pages** → Keep enough hue saturation to remain identifiable and verify all supported colors visually in representative PDF and EPUB themes.
- **`mix-blend-mode: multiply` changes the perceived opacity in PDFs** → Tune the palette with the actual PDF layer stack and remove the blend mode if it prevents parity or legibility.
- **Unknown custom CSS colors may still be opaque** → Guarantee readability for supported colors and known persisted aliases; validate or safely normalize additional formats where feasible without breaking custom-color compatibility.
- **Search and saved highlights can overlap** → Keep their styles independent so the active search indication can remain stronger without changing the saved extract treatment.

## Migration Plan

No data migration is required. Ship the renderer and palette changes together; all existing extracts adopt the new appearance when opened. Rollback consists of restoring the previous palette and viewer styles, with no persisted-data impact.

## Open Questions

None. Exact RGBA values will be finalized during implementation through visual verification in representative light and dark reader themes while respecting the spec's readability requirements.
