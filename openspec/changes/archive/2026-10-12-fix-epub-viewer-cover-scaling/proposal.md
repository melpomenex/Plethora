## Why

When users open an EPUB book in Plethora, the cover page image is rendered with unconstrained height (`max-width: 100% !important; height: auto !important;`) and without SVG viewBox constraints or viewport-aware sizing inside the reader iframe. On desktop windows, tablets, and mobile devices, portrait book covers expand horizontally to the full viewport width and scale to 1500–2400px tall, causing the user to only see the top portion of the cover while the remainder is cut off or pushed down below the fold.

## What Changes

- Add viewport-aware image and SVG scaling rules in `applyContentOverrides` inside `EPUBViewer.tsx` so images and SVGs never exceed the reader viewport dimensions (`max-height` bounded to the available reader viewport height, `object-fit: contain`).
- Pass reader viewport dimensions (`--epub-viewport-height`, `--epub-viewport-width`) into the EPUB iframe documents and keep them updated on reader resize.
- Detect EPUB cover sections (first spine section with image/SVG, sections with `cover` or `titlepage` identifiers, Calibre cover metadata, or standalone image pages) and apply cover-specific styling that eliminates excessive body padding/margins and centers the cover image within the viewport.
- Normalize SVG covers (such as Calibre `<svg>` wrappers and fixed pixel SVG dimensions) to ensure proper `viewBox`, `preserveAspectRatio="xMidYMid meet"`, and bounded width and height.
- Add test coverage for EPUB cover image and SVG scaling in the EPUB reader.

## Capabilities

### New Capabilities
- `epub-viewer-cover-scaling`: Defines viewport fitting, aspect ratio preservation, and cover page layout rules for EPUB book covers and standalone images inside the reader.

### Modified Capabilities

## Impact

- Frontend: `src/components/viewer/EPUBViewer.tsx` (reader iframe content styling, SVG normalization, and cover page detection).
- Tests: `src/components/viewer/__tests__/EPUBViewer.test.tsx` (unit tests verifying cover image and SVG styling, viewport constraints, and cover page layout).
- No API, database schema, or backend changes required.
