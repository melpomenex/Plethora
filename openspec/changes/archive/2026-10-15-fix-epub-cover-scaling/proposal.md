## Why

On mobile, EPUB book covers can appear oversized or cropped in the library dashboard's wide horizontal cards. The card fills its fixed cover frame with the image and applies a hover zoom, which makes portrait book artwork appear too large and cuts off parts of the cover.

## What Changes

- On mobile library dashboard cards, scale and center EPUB covers inside the existing cover frame while preserving their aspect ratio.
- Disable the hover zoom for EPUB covers on mobile so touch interaction does not enlarge or crop the cover.
- Keep desktop and non-EPUB cover presentation unchanged, and keep existing card dimensions.
- Add coverage for mobile EPUB cover presentation and the unchanged desktop behavior.

## Capabilities

### New Capabilities
- `epub-cover-presentation`: Defines how EPUB book covers fit within mobile library dashboard cards.

### Modified Capabilities

## Impact

- Frontend: `src/components/documents/DocumentsView.tsx` mobile `LibraryCard` cover rendering.
- Tests: Documents view component coverage for mobile and desktop cover presentation.
- No API, database, or dependency changes are expected.
