## Why

Vim reading mode promises keyboard-native document navigation, but EPUB reflow/iframe replacement and PDF page virtualization make its cursor and selections depend on short-lived DOM nodes. The result is a mode that can appear cursorless, reset during navigation, or produce incomplete context precisely in the long-form documents where it should feel most powerful.

## What Changes

- Replace viewport-only token indexing with a document-aware reading caret that has a stable EPUB CFI or PDF page/text-offset location and survives reflow, zoom, pagination, virtualization, and chapter/page changes.
- Make normal-mode navigation continuous across EPUB sections and PDF pages, automatically revealing the destination while preserving the user's preferred visual column for vertical motions.
- Add a polished, unmistakable Vim reading HUD: a real block caret, mode pill, pending-key/operator feedback, location context, and a compact action dock that appears only when useful.
- Make visual and visual-line selections first-class document ranges, including selections that cross rendered page/section boundaries and restore as content mounts.
- Add a keyboard-first selection action flow for instant extraction, extract editing, copying, highlighting by color, flashcard creation, and command-palette extensions, with clear success/failure feedback and predictable post-action cursor placement.
- Preserve mouse/touch selection and existing reader navigation outside Vim mode; Vim mode remains opt-in and yields safely to dialogs, inputs, browser find, and accessibility interactions.
- Add adapter contracts, deterministic location/range conversion, lifecycle handling, and coverage for EPUB and PDF edge cases.

## Capabilities

### New Capabilities

- `document-vim-navigation`: Stable modal caret navigation over the logical text of EPUB and PDF documents, independent of the currently mounted DOM.
- `document-vim-selection-actions`: Visual-range selection and keyboard-driven capture actions with high-fidelity EPUB/PDF source locations.
- `document-vim-experience`: Mode communication, contextual command discovery, feedback, accessibility, and safe interaction with reader chrome and dialogs.

### Modified Capabilities

None.

## Impact

- Affects the shared Vim engine/store and its motion, selection, caret, action, and adapter utilities.
- Affects `DocumentViewer`, `EPUBViewer`, and `PDFViewer`, including epub.js rendition lifecycle hooks and pdf.js text-layer virtualization hooks.
- Extends internal reader-adapter and selection-context contracts; no external API or persisted document-format breaking change is required.
- Adds focused unit, integration, and end-to-end coverage for modal navigation, cross-boundary ranges, reflow/zoom restoration, action dispatch, and focus safety.
