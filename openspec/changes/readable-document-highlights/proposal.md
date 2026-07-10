## Why

Saved extracts in the PDF and EPUB readers are currently rendered with a bright, opaque yellow that can obscure glyphs and make the source text difficult to reread. Highlights should remain immediately recognizable without reducing the legibility of the content they annotate.

## What Changes

- Replace the saturated default yellow overlay in PDF and EPUB readers with a softer, translucent highlight treatment that preserves text contrast.
- Apply a consistent readable treatment to every supported extract color while retaining enough visual distinction between colors.
- Keep persisted extract color values and the existing default-color behavior unchanged; this change affects reader rendering only.
- Ensure existing and newly created extracts use the improved appearance in both light and dark reading contexts.
- Add focused coverage for highlight palette mapping and reader rendering so legibility does not regress.

## Capabilities

### New Capabilities
- `readable-reader-highlights`: Defines visible, text-legible rendering of saved extract highlights across PDF and EPUB readers and supported themes.

### Modified Capabilities

None.

## Impact

- Affects the PDF highlight layer/styles and EPUB annotation styling in `src/components/viewer`.
- May introduce a shared highlight-palette utility or CSS variables used by both viewers.
- Does not change extract storage, color identifiers, APIs, database schemas, dependencies, or the extraction workflow.
