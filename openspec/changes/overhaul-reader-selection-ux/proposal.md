## Why

Incrementum's contextual text-selection actions misbehave on exactly the surfaces where users read most: reflowed PDFs and EPUBs, worst on narrow touch/e-ink devices (Boox Palma 2). Two user-visible failures share one root cause — the selection action UI's lifecycle is coupled to live DOM selection state:

1. **The action sheet appears while the user is still selecting.** For EPUB/HTML (iframe content), `DocumentViewer` opens the sheet straight off `activeExtractSelection` (`DocumentViewer.tsx:1079-1088`), which EPUBViewer updates immediately on every iframe `selectionchange`/`touchend` (`EPUBViewer.tsx:1042-1045, 2530-2557`) — no settling at all. For reflowed PDFs, the 500 ms stability gate exists (`DocumentViewer.tsx:3570-3767`) but any pause ≥500 ms between handle adjustments opens a modal scrim+bottom-sheet over the handles, and once open it never re-hides when the user resumes adjusting. On a Palma 2 the sheet covers the passage being selected.
2. **Actions/results vanish after invocation.** The sheet's `open` prop is keyed to live selection text, and `handleSelectionChange` → `hideSelectionUi()` (`DocumentViewer.tsx:3719-3726`) fires whenever the top-document selection reads empty. Tapping an action often collapses the native selection (focus shift, tap outside the text), which unmounts the sheet mid-AI-run — aborting the request and discarding the loading/result state. Selection geometry is also captured once at settle and never refreshed, and stale selections survive EPUB page turns.

## What Changes

- Introduce a **shared selection-interaction controller** (explicit state machine: `idle → selecting → settling → ready → actionRunning → resultVisible`) replacing the per-surface ad-hoc booleans in `DocumentViewer`, with adapters for top-document content (reflowed PDF, markdown, OCR-HTML), EPUB/HTML iframes, and PDF fixed mode.
- **Suppress all Incrementum selection UI while the selection is actively changing**; show it only after interaction settles (touch/pointer release + range stability), and immediately re-hide when adjustment resumes. Apply to EPUB, reflowed PDF, markdown, HTML, and desktop mouse selection alike.
- **Decouple action execution from live selection**: invoking an action captures an immutable selection snapshot (text, passage, context/anchor, geometry, document/reader identity, operation ID). Loading/result/error UI stays mounted regardless of what happens to the native selection, until deliberately dismissed or the reading context changes.
- **Viewport-safe anchored placement**: a compact, horizontally scrollable action bar anchored above/below the selection (iframe offsets included for EPUB), clamped to the visual viewport and safe areas; the full bottom sheet remains for overflow actions, AI loading/results, and errors. Never centered over the passage.
- **E-ink and narrow-screen discipline**: no scrim during selection, no animation dependence (`usePresentation().reducedMotion`), throttled geometry recomputation, stable layout changes only.
- **Stale-request safety**: operation IDs + abort on dismiss, document switch, EPUB chapter navigation, and reflow relayout; results from an old selection can never render over a newer one.
- Extend, don't replace: keep `SelectionActionsSheet` (AI lifecycle owner), `SelectionPopup` (desktop PDF), the shared `ContextMenu`, `touchSelectionDismissal.ts` semantics (including the Android "never `removeAllRanges()`" workaround and text-keyed suppression), and all existing actions (Extract, Highlight, Copy, Dictionary, Flashcard, Explain/Summarize/Simplify/Key Terms/Ask, Learn This, Ask Library, Tutor, Prerequisites).

## Capabilities

### New Capabilities

- `reader-selection-interaction`: The selection-phase lifecycle across all reader surfaces — suppression during active selection adjustment, settle detection, re-hide on re-adjustment, scroll semantics, viewport-safe anchored action-bar placement (iframe-aware), narrow-screen/e-ink behavior, and desktop/touch parity.
- `selection-action-lifecycle`: The action-phase lifecycle — immutable selection capture at invocation, visible loading, persistent result/error presentation, retry, cancellation and stale-request ownership across surfaces and reading-context transitions.

### Modified Capabilities

(none — the existing selection-related specs `mobile-selection-ai-actions` and `touch-selection-dismissal` live in unarchived changes; this change supersedes their UX contracts via the two new capabilities above without altering their archived-eligible requirements.)

## Impact

- `src/components/viewer/DocumentViewer.tsx` — selection state hub: `mobileSelection`/`activeExtractSelection` wiring (963–1098), `updateSelection` (1265–1308), mobile stability effect (3570–3767), `buildContextMenuItems` (2060–2210), sheet/menu mounts (7700–7868).
- `src/components/viewer/EPUBViewer.tsx` — iframe selection bridge, coordinate transform, chapter/page-turn invalidation.
- `src/components/viewer/PDFViewer.tsx` + `PdfCanonicalReflowRenderer.tsx` — reflow selection commit (`handleReflowSelection` 1717–1780), fixed-mode popup coexistence, relayout/typography-change invalidation.
- `src/components/viewer/SelectionActionsSheet.tsx`, `SelectionPopup.tsx`, `touchSelectionDismissal.ts` — snapshot-based open state, shared placement helper.
- New module: `src/components/viewer/selectionInteraction/` (machine, geometry/placement, adapters, hook).
- Secondary hosts to migrate: `src/components/media/TranscriptPanel.tsx`, `src/pages/QueueScrollPage.tsx`.
- Infrastructure reused: `src/components/common/MobileContextMenuSheet.tsx`, `ContextMenu.tsx`, `src/contexts/PresentationContext.tsx`, `src/hooks/useVisualViewport.ts`, `src/lib/ai/passageAI.ts`.
- Tests: new unit suites for the machine, placement, and capture semantics; existing suites in `src/components/viewer/__tests__/` must keep passing.
