## 1. Stable Document Model

- [x] 1.1 Add typed EPUB/PDF `DocumentPosition`, ordered `DocumentRange`, affinity, capability, and immutable action-snapshot models with comparison and serialization helpers.
- [x] 1.2 Make stable positions and ranges authoritative for EPUB/PDF V2 while isolating cursor/anchor numeric indexes as a temporary legacy cache for HTML/Markdown; keep mode, pending operator, count, desired visual column, and action feedback state explicit.
- [x] 1.3 Define the asynchronous document Vim adapter contract for position resolution, semantic motion, reveal, geometry, range text/context, pointer mapping, and lifecycle invalidation.
- [x] 1.4 Add unit tests for position ordering, reversed ranges, quote fallbacks, store transitions, and stale navigation request cancellation.

## 2. EPUB Logical Adapter

- [x] 2.1 Build lazy spine-section text/block/token indexes with CFI boundaries, normalized reading order, bounded caching, and adjacent-section idle prefetch.
- [x] 2.2 Implement EPUB motion resolution across visual lines, words, paragraphs, sections, and document boundaries with count and desired-column support.
- [x] 2.3 Implement CFI-first position restoration and quote/offset fallback across rendition replacement, reflow, font changes, and pagination-mode changes.
- [x] 2.4 Implement complete logical range text extraction, CFI range generation, mounted native-selection rendering, and offscreen continuation/restoration.
- [x] 2.5 Wire epub.js contents, rendered, relocated, resize, and destruction events into targeted cache/geometry invalidation rather than engine recreation.
- [x] 2.6 Add EPUB fixtures and tests for nested markup, split text nodes, ligatures/ruby text, section crossing, reflow, reversed selection, and exact extract/highlight CFI ranges.

## 3. PDF Logical Adapter

- [x] 3.1 Build lazy page text-content indexes independent of mounted text layers, including geometry-aware lines, blocks, offsets, reading-order metadata, and bounded page caching.
- [x] 3.2 Implement PDF motion resolution across visual lines, words, paragraphs, pages, and document boundaries with count and desired-column support.
- [x] 3.3 Implement page/text-offset caret restoration and mounted geometry mapping across zoom, rotation, page virtualization, resize, and text-layer recreation.
- [x] 3.4 Implement logical multi-page ranges, per-page selection overlays, continuation affordances, and canonical page offset/rectangle context generation.
- [x] 3.5 Replace the periodic PDF model rebuild with page text-content, render, virtualization, zoom, and resize lifecycle signals.
- [x] 3.6 Detect image-only/unmapped pages and expose an honest unavailable state, opting in existing OCR output only when word geometry is reliable.
- [x] 3.7 Add PDF fixtures and tests for multi-column text, split items, rotation/zoom, virtualized page crossing, reversed selection, and multi-page capture context.

## 4. Engine and Input State Machine

- [x] 4.1 Refactor `VimCursorEngine` to resolve logical asynchronous motions, coalesce repeated input, retain the last visible caret during reveals, and ignore stale completions.
- [x] 4.2 Implement normal, visual, visual-line, operator-pending, count-prefix, cancellation, and normal-to-inactive transitions over stable positions.
- [x] 4.3 Preserve visual x-axis intent for vertical motions and implement deterministic movement across short lines and format boundaries.
- [x] 4.4 Add pointer/touch mapping so text clicks move the caret, drags become Vim ranges, and reader-chrome interactions preserve position.
- [x] 4.5 Centralize focus eligibility so editable controls, dialogs, command palette, find UI, and accessibility focus owners receive keys before Vim activation or handling.
- [x] 4.6 Ensure reader page/TOC/navigation bindings defer while Vim is active and resume immediately after deactivation.
- [x] 4.7 Add engine/integration tests for rapid repeats, async boundary navigation, focus conflicts, Escape ladders, pointer adoption, and document changes.

## 5. Caret, Range, and Reading Rail UX

- [x] 5.1 Replace the transient span overlay with a portal-based caret renderer supporting normal, visual, operator-pending, loading, high-contrast, and reduced-motion states.
- [x] 5.2 Implement mounted selection renderers for EPUB and PDF plus edge continuation indicators for logical range portions outside the viewport.
- [x] 5.3 Build the responsive Reading Rail with mode capsule, chapter/page/progress location, pending count/sequence/operator, dimming behavior, safe-area placement, and screen-reader announcements.
- [x] 5.4 Build the visual-mode action dock using resolved shortcut labels for extract, edit, copy, highlight, flashcard, and more commands without obscuring the active range.
- [x] 5.5 Build the keyboard/touch-accessible highlight color strip with live range preview, confirm/cancel behavior, theme-aware colors, and focus containment.
- [x] 5.6 Add concise success, resolving, unavailable, and retryable failure feedback that preserves or collapses the range according to the specs.
- [x] 5.7 Add a one-time activation hint and mode-sensitive `?` help populated from configured shortcuts and localized strings.
- [x] 5.8 Add visual and accessibility tests across light/dark themes, narrow/mobile safe areas, high contrast, zoomed text, reduced motion, and screen-reader semantics.

## 6. Canonical Selection Actions

- [x] 6.1 Add an adapter snapshot boundary that freezes complete text, positions, and format-specific selection context before any action dispatch.
- [x] 6.2 Route instant extract, editable extract, copy, highlight, flashcard, command-bar actions, and operator aliases through the canonical snapshot instead of live/stale DOM selection state.
- [x] 6.3 On success, return to normal mode at the former range start and announce the result; on failure, preserve the range and provide retry/cancel actions.
- [x] 6.4 Verify persistent EPUB highlights use exact CFI ranges and PDF highlights/extracts retain all covered page rectangles after remounting.
- [x] 6.5 Add action tests for success, failure, slow persistence, clipboard rejection, color selection, flashcard seeding, and unmounted range content.

## 7. Integration, Rollout, and Validation

- [x] 7.1 Integrate the new adapters and Reading Rail into `DocumentViewer`, `EPUBViewer`, and `PDFViewer`, switching EPUB/PDF directly to V2 while retaining the existing engine only for static HTML/Markdown behavior.
- [x] 7.2 Add end-to-end keyboard journeys for activate → navigate → cross-boundary visual select → extract/highlight/copy/card → return to normal → deactivate in both formats.
- [x] 7.3 Add regression coverage for native mouse selection, reader shortcuts, command palette, search/find, dialogs, persisted highlights, TTS/sync overlays, and non-Vim reading.
- [x] 7.4 Profile first-caret latency, repeated-motion responsiveness, cache size, selection over long ranges, and reflow/zoom churn against large EPUB/PDF fixtures and tune budgets.
- [x] 7.5 Document the user-facing shortcuts and UX, remove legacy EPUB/PDF polling/index paths in the same change, and verify the integration commit can be cleanly reverted without data migration.
