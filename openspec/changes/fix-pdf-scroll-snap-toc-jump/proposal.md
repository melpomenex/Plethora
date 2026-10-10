## Why

PDF and EPUB readers have competing viewport writers: gesture-driven page turns, deferred resize redisplays, saved-position restoration, TOC resolution, and TTS following. The earlier PDF fix still permits same-page TOC misses and saved-position replay. Explicit navigation must have deterministic, cancellable ownership across both formats.

## What Changes

- Consolidate the unresolved PDF work here, expanding the design to shared reader navigation ownership and parent/child restoration coordination.
- Resolve fixed PDF destinations with rendered zoom/rotation geometry and reflow destinations with source block geometry, including multiple headings on one page.
- Invalidate superseded destination resolution and rendering on direct input or newer navigation.
- Remove EPUB continuous-scroll swipe page turns and relocation-triggered resize correction. Preserve paginated vertical gestures and horizontal Android back gestures.
- Resolve EPUB fragments to heading CFIs, retaining the fragment through fallback resolution and verifying the mounted destination.
- Make initial saved-position restoration one-time and cancellable; retain TTS follow and re-center semantics, selection, bookmarks and progress persistence.
- Add regression coverage and an honest Android verification matrix.

## Capabilities

### New Capabilities

- `pdf-navigation-stability`: Keep and extend this change's existing capability for deterministic PDF navigation and initial restoration. No duplicate PDF capability is introduced.

### Modified Capabilities

- No new deltas against archived baseline capabilities. Amend the pending `epub-reading` TOC/continuous-scroll requirements in `fix-epub-scroll-pdf-resume` and the pending `tts-follow-behavior` requirements in `fix-reader-tts-mobile-autoscroll-crash` directly; those requirements are not yet in `openspec/specs`.

## Impact

`EPUBViewer.tsx`, `PDFViewer.tsx`, `DocumentViewer.tsx`, the existing TTS follow controller, and small navigation/anchor helpers. No new dependency, public API, persisted-position schema, branch, or PR is required. Existing manual PDF validation remains pending and is expanded to Android EPUB/PDF modes.
