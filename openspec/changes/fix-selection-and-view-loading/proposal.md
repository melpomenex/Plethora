## Why

Four regressions reported from real usage break core reading flows: desktop PDF readers have no right-click selection menu (EPUB has one), the mobile PDF toolbar hugs the screen edges, a selection made in a reflowed PDF on mobile can never be dismissed so the AI action sheet re-opens on every scroll, and on mobile (now also desktop) the Queue/Documents views render empty on first visit until the user navigates away and back.

## What Changes

- **Desktop PDF context menu**: add a `contextmenu` listener to the PDF viewer's selection surface, an `onContextMenu` prop on `PDFViewer` mirroring `EPUBViewer`'s, and un-gate the shared `ContextMenu` render (currently hard-excluded via `docType !== "pdf"`) so right-clicking a PDF text-layer selection shows the full menu (Create Extract, Add note, Highlight colors, Copy, Dictionary/Thesaurus, Flashcard, Explain/Summarize/Simplify/Key terms/Ask, Learn this).
- **Mobile PDF toolbar spacing**: give the mobile PDF reader toolbar (original/reflow toggle on the left, page/zoom cluster on the right) and the DocumentViewer mobile compact toolbar proper edge clearance by consuming the existing `--shell-safe-left/right` variables (landscape notch insets) plus a minimum horizontal padding, matching the clearance the EPUB floating header already has.
- **Touch selection dismissal**: make scrolling the reflowed PDF dismiss the selection actions sheet and clear the app's selection state (without programmatically clearing the native selection, which wedges Android WebView), and harden the dismissed-selection guard so reflow DOM churn (lazy page sections mutating around a live selection) cannot re-arm the sheet for an already-dismissed selection.
- **First-activation view loading**: fix the race where views load with a not-yet-hydrated `activeCollectionId` (placeholder id → empty result, discarded stale responses, no re-trigger): add collection-change re-loading to the Documents view, make the desktop Queue view only claim its `loadedQueryKey` after a successful load (with retry, like the mobile view), and stop caching a rejected backend-readiness promise forever.

## Capabilities

### New Capabilities

- `pdf-desktop-selection-menu`: Right-click (context menu) access to the full selection action set on desktop PDF viewers, with valid PDF selection provenance for extract/highlight actions.
- `mobile-pdf-chrome-spacing`: Edge and safe-area clearance for the mobile PDF reader toolbar and its DocumentViewer compact toolbar across devices and orientations.
- `touch-selection-dismissal`: Reliable dismissal of the selection actions sheet on touch surfaces (scrim tap, scroll, tap-away), with no re-surfacing from a dismissed selection.
- `view-first-load-reliability`: Queue and Documents views load their data on first activation without requiring a navigate-away-and-back cycle.

### Modified Capabilities

(none — no existing spec in `openspec/specs/` covers these behaviors)

## Impact

- `src/components/viewer/PDFViewer.tsx` — contextmenu listener, `onContextMenu` prop, reflow scroll dismissal hook.
- `src/components/viewer/DocumentViewer.tsx` — ContextMenu render gate, mobile compact toolbar padding, selection-sheet dismissal guard/scroll handling.
- `src/components/viewer/PDFViewer.css` — toolbar safe-area/edge padding.
- `src/components/documents/DocumentsView.tsx`, `src/stores/documentStore.ts` — collection-aware (re)loading.
- `src/components/review/ReviewQueueView.tsx`, `src/stores/queueStore.ts` — claim-after-success `loadedQueryKey` with retry.
- `src/lib/tauri.ts` — reset rejected backend-readiness promise.
- Tests: vitest suites near each touched module; no schema, dependency, or Rust API changes.
