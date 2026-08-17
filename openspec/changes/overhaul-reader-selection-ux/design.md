## Context

Incrementum's readers converge on a shared selection-action stack at the `DocumentViewer` level, but selection *detection* is implemented independently per surface, and the mobile action UI's visibility is keyed to live selection state. The relevant current state (verified in code):

**Selection UI components**

- `SelectionActionsSheet.tsx` — the mobile/touch action surface, built on `MobileContextMenuSheet` (full-screen scrim + bottom sheet, `createPortal`, body-scroll lock). Owns the AI lifecycle: streaming output, cancel, retry, error text, Copy/Create-extract-from-result. Mounted once per host: `DocumentViewer.tsx:7700`, `TranscriptPanel.tsx:322`, `QueueScrollPage.tsx:4443`.
- `SelectionPopup.tsx` — desktop-only floating toolbar (Highlight/Copy/Note) for PDF **fixed** mode; `position: fixed`, placement math `calculatePopupPosition` (above → flip below → viewport clamp), driven by `pdfSelectionPersistence.ts` reducer state (`popupVisible`/`popupRect`).
- Shared `ContextMenu` (`src/components/common/ContextMenu.tsx`) — desktop right-click menu; delegates to `MobileContextMenuSheet` on mobile; dismisses on iframe scroll/resize/blur via listeners attached into same-origin iframes.
- `SelectionOverlay.tsx` — persisted PDF selection highlight (not a menu); re-derives PDF-space rects through the live pdf.js viewport, so it survives zoom/scroll correctly.

**Selection detection (duplicated per surface)**

- Top-document content (PDF reflow DOM, markdown, OCR-HTML): `DocumentViewer.tsx:3570-3767` — mobile-only stability gate: `selectionchange` re-arms a 500 ms timer; `surfaceStableSelection` defers in 150 ms steps while a touch is active (cap `MAX_DEFER_MS = 3000` for system-consumed gestures); scroll-dismissal via `createScrollDismissGate` (8 px) and text-keyed suppression via `isSuppressedSelection` (`touchSelectionDismissal.ts`); never calls `removeAllRanges()` on touch (Android WebView wedge workaround).
- EPUB/HTML iframes: `EPUBViewer.tsx:1042-1045` subscribes `selectionchange`/`mouseup`/`touchend` inside each epub.js `contents.document`; `handleSelectionChange` (2530-2557) notifies the parent **immediately, with no settling**. The top-document stability gate never sees these events.
- PDF fixed mode: `PDFViewer.tsx:2734-2789` commits on `mouseup` (validated against pdf.js text layers), `setTimeout(0)` settle; deliberately no `selectionchange`-based clearing; explicit clear reasons only (`pdfSelectionPersistence.ts`).
- PDF reflow: `handleReflowSelection` on container `mouseup` (`PDFViewer.tsx:1767-1780`); canonical anchors via `pdfCanonicalReflowSelection.ts` (single-page only, line 103); zero-rect fallback context keeps menus working for multi-page selections.

**Root causes of the two reported bugs**

1. *Sheet appears mid-selection.* Sheet openness is `mobileMenuSheetOpen = Boolean(mobileSheetSource)` (`DocumentViewer.tsx:1086-1088`). For EPUB/HTML, `mobileSheetSource = mobileSelection.text || activeExtractSelection` — and since the iframe selection never reaches the top-document gate, `mobileSelection.text` stays empty and the sheet opens straight off `activeExtractSelection`, which updates on *every immediate iframe event* — no settle detection whatsoever. For reflowed PDF the 500 ms gate applies, but (a) any pause ≥500 ms between handle adjustments (lift right handle, think, grab left handle) opens a **modal scrim + bottom sheet** over the passage, and (b) once open, `surfaceStableSelection` bails (`if (mobileSheetOpenRef.current) return`) — the sheet "owns dismissal" and is never re-hidden when the user resumes adjusting; the scrim swallows the next handle grab.
2. *Actions/results vanish.* The same openness coupling runs in reverse: `handleSelectionChange` calls `hideSelectionUi()` whenever the top-document selection reads empty (`DocumentViewer.tsx:3719-3726`). Tapping a sheet action frequently collapses the native selection (focus shift / tap outside the text layer), so the sheet unmounts mid-AI-run; `SelectionActionsSheet`'s cleanup aborts the in-flight request and the loading/result state is lost. Additionally, geometry is captured once at settle (`position` at 3698-3706) and never refreshed, EPUB page turns don't invalidate selection state (stale text/menu can resurface), and there is no operation identity to prevent a late response from one selection rendering against another.

**Constraints**

- Android WebView: never programmatically clear a touch selection (`removeAllRanges()` wedges the native action mode); `touchend` is unreliable for system-consumed gestures; the native selection deliberately survives dismissal, so `selectionchange` keeps firing during reflow DOM churn — text-keyed suppression exists for this and must be preserved.
- E-ink (`PresentationContext`, `data-display-mode="eink"`): no animation dependence; EPUB defaults to paginated layout when `einkSettings.preferPaginated`.
- `MobileContextMenuSheet` caps its height against the visual viewport (`useVisualViewport` CSS vars), which is how sheets survive the on-screen keyboard.
- Desktop fixed-mode PDF selection has a deliberate, tested architecture (`pdfSelectionPersistence` explicit-clear reasons) that must not regress.
- React 19 / TS strict / vitest + jsdom + @testing-library; benchmark gate applies to `src/**/*.bench.ts` (this change adds no hot loops, but must not introduce per-`selectionchange` layout reads).

## Goals / Non-Goals

**Goals:**

- One selection-interaction model — explicit, deterministic, unit-testable — shared by EPUB (scrolled + paginated), reflowed PDF (canonical v2 and v1 fallback), markdown, OCR-HTML, HTML iframe, PDF fixed mode, and the secondary hosts (transcripts, RSS scroll page).
- Zero Incrementum UI over the passage while the selection is actively changing; actions appear only after settle; instant re-hide on resumed adjustment.
- Invoking an action captures an immutable snapshot; loading/result/error UI remains visible until deliberately dismissed or the reading context genuinely changes — regardless of native-selection collapse, focus changes, or document scrolling.
- Viewport-safe, iframe-aware anchored placement of the touch action bar; horizontally scrollable compact actions on narrow screens.
- E-ink-appropriate behavior: no scrim during selection, reduced-motion respected, throttled geometry updates, no polling.
- Preserve every existing action and its data flow (Extract, Highlight, Copy, Dictionary, Flashcard, AI actions, Learn This, Ask Library, Tutor, Prerequisites) and the Android selection-preservation workarounds.

**Non-Goals:**

- Multi-page canonical reflow anchoring (`pdfCanonicalReflowSelection.ts` phase-8 note) — anchored placement uses live range geometry, which already spans pages.
- Replacing the desktop right-click `ContextMenu` or the PDF fixed-mode `SelectionPopup`/`SelectionOverlay` persistence architecture; only their placement math consolidates.
- Changing how AI requests execute (`src/lib/ai/passageAI.ts`, on-device vs cloud routing) — only who owns their lifecycle state.
- Modifying native selection behavior itself (handles, magnifier, system toolbar); Incrementum coexists with it.
- Desktop hover-preview or keyboard range selection features.

## Decisions

### 1. A shared headless controller with an explicit state machine, owned by each host

New module `src/components/viewer/selectionInteraction/`:

- `machine.ts` — pure, framework-free reducer + types (the pattern of `pdfSelectionPersistence.ts` and `touchSelectionDismissal.ts`):
  ```
  IDLE → (selection activity) → SELECTING → (release + range stable) → SETTLING
       → (stable confirmed) → READY → (action invoked) → ACTION_RUNNING
       → (success | failure) → RESULT_VISIBLE → (dismiss | context invalidation) → IDLE
  SELECTING/SETTLING ← (any selection change or content touch) from READY   // AC7
  READY ← (re-settle) ← SELECTING
  ```
  Inputs: `selectionChanged(fingerprint, hasText)`, `pointerDown/pointerUp`, `touchStart/touchEnd/touchCancel`, `contentScroll`, `actionInvoked(snapshot)`, `actionSettled(outcome, operationId)`, `dismiss`, `contextInvalidated(reason)`. Suppression keys (text-keyed, from `touchSelectionDismissal.ts`) enter as machine inputs rather than scattered refs.
- `geometry.ts` — pure helpers: `fingerprintRange(range)` (start/end container+offset identity — cheap, no layout), `captureSelectionGeometry(range, iframeOffset?)` (viewport-space rect + client-rects union), `placeAnchoredBar(selectionRect, barSize, viewport, insets)` (above → below → nearest safe region; never centered over the passage).
- `useSelectionInteraction.ts` — React binding: owns timers (settle debounce, defer cap), subscribes adapters, exposes `{ phase, liveSelection, readySelection, capturedAction, anchors }` and imperative `capture()`, `invalidate(reason)`.
- Adapters: `topDocumentAdapter` (reflow PDF, markdown, OCR-HTML — the current `DocumentViewer` effect's listeners, generalized), `iframeSelectionBridge` (registered by `EPUBViewer`'s content hook and the HTML-iframe host: forwards iframe `selectionchange`/touch events and adds `frameElement.getBoundingClientRect()` offsets, the existing `EPUBViewer.tsx:1204` transform), and a commit-port for PDF fixed mode (feeds the already-validated `commitSelection` output in as a `READY` transition).

**Alternatives considered:** fixing EPUB and reflow PDF separately (rejected — the divergence between the two code paths is what produced the bugs; three hosts already copy the sheet pattern); a global zustand `selectionStore` (rejected — selection is transient per-surface UI state tied to a mounted reader, not a persisted domain; zustand stores in this repo are for the latter. The machine is instantiable per host and testable in isolation).

### 2. Settle detection = interaction release + range-identity stability (bounded), not a longer delay

`SETTLING` completes only when **no touch/pointer is active** AND the range fingerprint has been stable for `SELECTION_STABLE_MS` (default 500 ms, tunable constant) — re-armed by every `selectionChanged`. The existing defer loop (150 ms steps, `MAX_DEFER_MS` 3000 cap) is retained for Android's system-consumed gestures. Desktop mouse selection enters `READY` at `mouseup` + fingerprint match (no artificial delay — current desktop timing preserved).

The "pause between handle adjustments" ambiguity is not solved by a bigger timer (the brief explicitly forbids a sluggish hard delay) but by making a premature appearance *harmless and recoverable*: the touch action UI is a compact anchored bar with **no scrim** (Decision 3), so if it appears while the user is still deciding, grabbing a handle again instantly returns the machine to `SELECTING` and hides the bar. The user never has to fight a modal to continue adjusting — that is the actual defect on Palma 2 today.

### 3. Touch: compact anchored action bar for the menu; bottom sheet for overflow, loading, and results

New `SelectionActionBar` component (portal, `position: fixed`): a single horizontally-scrollable chip row — `Summarize · Explain · Ask · ⋯` primary AI actions plus Extract, with lower-priority actions under `⋯` (opens the existing `SelectionActionsSheet` in menu mode). Placed with `placeAnchoredBar`:

- preferred above the selection; below when insufficient room above; otherwise clamped into the nearest safe viewport region;
- respects `--shell-safe-*` insets, `useVisualViewport` keyboard height, Android gesture areas;
- never rendered over the selection's first/last client rect when any alternative exists; never centered on the passage;
- full-width-capped to the viewport minus insets; on Palma 2-class widths the row scrolls horizontally rather than growing vertically.

Loading/result/error remain in `SelectionActionsSheet` (bottom sheet): long-form results need scrollable space, and a viewport-pinned sheet *cannot* finish offscreen — which satisfies the result-visibility requirements structurally. The sheet's `open` becomes a function of machine phase, not of live selection text.

**Alternatives considered:** keeping the modal bottom sheet as the initial menu (rejected — on narrow screens it covers the passage and its scrim blocks selection handles; it remains reachable via `⋯` and remains the result surface); anchoring results next to the selection (rejected — selection coordinates go stale while the document scrolls during a long AI run; a pinned sheet is the honest answer).

### 4. Immutable application-owned snapshot at action invocation

When any action is invoked (bar chip, sheet row, context-menu item), the controller builds a `CapturedSelection`:

```ts
{
  operationId,            // uuid — staleness key
  text, passage,          // from readySelection (captured at settle)
  selectionContext,       // EpubSelectionContext (CFI) | PdfSelectionContext (canonical/legacy) | null
  geometry,               // viewport rect + fingerprint (best effort)
  documentId, surface,    // 'epub' | 'pdf-fixed' | 'pdf-reflow' | 'markdown' | 'html' | ...
  readerContext,          // chapter/CFI/page/mode at capture time
  capturedAt,
}
```

This generalizes the two patterns that already work — `buildContextMenuItems`' capture-at-click (`DocumentViewer.tsx:2185-2191`, "Captured now, while the selection is still live") and `mobileSelection.passage` captured at settle — into one ownership rule: **once a phase ≥ `ACTION_RUNNING`, live-selection events no longer influence UI visibility.** The empty-selection → `hideSelectionUi()` path (3719-3726) becomes a machine input that only demotes `SELECTING/SETTLING/READY` — it can never unmount a running/result sheet. Native selection collapse, focus changes, rerenders, and content scrolls are all survivable by construction.

The visible selection is preserved where technically feasible (Android: the native selection is already left alive; desktop: sheet opening doesn't clear ranges today, and `copySelectionTextToClipboard`'s range-preserving fallback pattern shows the technique when we must interact with the clipboard).

### 5. Geometry lifecycle: capture at settle, revalidate cheaply, invalidate on relayout

- **Capture** at `READY`: viewport-space rect via `Range.getBoundingClientRect()` (+ `getClientRects()` for edge awareness), iframe-offset-adjusted for EPUB/HTML.
- **Reposition** the anchored bar on scroll/resize/`visualViewport` changes, rAF-throttled: re-read the live range only if its fingerprint still matches the captured one; if the selection no longer matches or is gone, dismiss the bar (a bar anchored to a dead geometry is worse than none). Results are pinned and never re-anchor.
- **Invalidate** on: EPUB chapter/page turn (`relocated`), font/typography changes (EPUB `applyRenditionTheme`, reflow CSS-var sliders `PDFViewer.tsx:4220-4237`), reflow regeneration/OCR page replacement, document/mode switches. Invalidation dismisses bar + `READY` state, aborts in-flight operations, and clears stale `lastEpubSelectionContextRef`-style residue.
- PDF fixed mode keeps its existing `popupRect`-frozen-at-commit + hide-on-scroll behavior (already correct); its placement math merely moves to the shared helper.
- Multi-line/larger-than-viewport selections anchor to the first visible client rect intersecting the viewport (fallback: last rect), so the bar never anchors offscreen for tall selections.

### 6. Staleness and cancellation via operation ownership

Every AI run carries the snapshot's `operationId`. `SelectionActionsSheet` already aborts on close; additionally: completions whose `operationId` ≠ the active one are ignored (late responses can't overwrite a newer selection's result); `contextInvalidated` (document switch, chapter navigation, reflow relayout, deliberate close) aborts the in-flight request and drops the snapshot. Retry reuses the same snapshot (the brief's "retry without re-selecting"). This also fixes the EPUB page-turn staleness gap found in exploration (no selection-state reset on `handlePrevPage`/`handleNextPage`).

### 7. Responsibilities: shared core, thin surface adapters

| Concern | Owner |
| --- | --- |
| State machine, settle detection, suppression, timers | `selectionInteraction/` (shared) |
| Geometry capture, placement math, revalidation | `selectionInteraction/geometry.ts` (shared) |
| Action bar UI, sheet open-state wiring, snapshot creation | `DocumentViewer` (shared for all its children) |
| EPUB: iframe event bridging, coordinate offsets, `relocated`/theme invalidation, paginated+scrolled | `EPUBViewer` adapter |
| Reflow PDF: word-span selections, zero-rect multi-page fallback, CSS-var typography invalidation, `data-pdf-reflow-block` passage context | `PDFViewer` + renderer (existing) |
| PDF fixed: validated commit port, popup/overlay persistence (unchanged) | `PDFViewer` |
| Secondary hosts (transcripts, RSS) | same controller, `topDocumentAdapter` |

Two small collateral fixes ride along: `ReaderTapZones` checks the *top-level* selection (`ReaderTapZones.tsx:67-72`), which never sees EPUB iframe selections — it consults the controller instead; and the `isReflowActive: false` placeholder (`DocumentViewer.tsx:1049-1051`) gets a real signal from the controller's surface state (recall prompts stop firing while a selection interaction is active).

### 8. E-ink and narrow screens

No scrim during `SELECTING/SETTLING/READY` (scrim exists only for the sheet's overflow/result modes). All bar/sheet transitions suppressed under `usePresentation().reducedMotion` (already covers e-ink + `prefers-reduced-motion`) — placement changes are single discrete steps, never animated drift. Geometry recomputation is rAF-throttled and fingerprint-gated, so e-ink repaints only on real changes. The bar's chip row keeps ≥44 px touch targets by scrolling horizontally instead of shrinking (the `mobileSheetItemClass` 48 px convention). No polling loop anywhere: everything is event-driven with bounded timers.

### 9. Accessibility

Action bar: `role="toolbar"` with aria-label, buttons keyboard-focusable with visible labels (i18n), Escape dismisses and returns focus to the reader container, targets ≥44 px. Loading: `aria-busy` on the result container and streamed output in an `aria-live="polite"` region (success/failure announced). Result/error panel keeps `MobileContextMenuSheet`'s `role="dialog" aria-modal` semantics with focus trap and restore. All motion gated on reduced-motion. No native accessibility machinery (system selection handles, magnifier, a11y text-selection) is suppressed.

### 10. Performance

`selectionchange` fires continuously during handle drags; the handler does an O(1) fingerprint comparison and nothing else — **no layout reads, no React state updates** per event (phase only changes on transition boundaries). `getBoundingClientRect` runs at settle and inside rAF-throttled revalidation only. The bar is memoized on `{placement, readySelection.text}`. All listeners cleaned up on unmount; timers cleared on every transition. No new `src/**/*.bench.ts` baseline changes are expected (no per-frame work added); if profiling during QA shows regressions in reader scroll, the benchmark gate protocol applies.

## Risks / Trade-offs

- **[Anchored bar mispositions on exotic WebView zoom/visual-viewport combinations]** → placement is clamped defensively to the layout viewport; worst case the bar docks to the top safe region — never offscreen; geometry unit tests enumerate the matrix (top/bottom/edges/center/narrow).
- **[Settle window (500 ms) still guesses intent on slow deliberators]** → the no-scrim bar makes a wrong guess instantly recoverable (touch = hide); suppression keys prevent re-show churn; constant is tunable per-build if Palma 2 QA says otherwise.
- **[Android system-consumed gestures keep the old wedge risks]** → keep `touchSelectionDismissal.ts` semantics verbatim inside the machine (text-keyed suppression, defer cap, never `removeAllRanges()`); the existing tests migrate as machine tests.
- **[EPUB iframe bridge doubles event sources (epub.js `selected` + our listeners)]** → the bridge treats epub.js contexts as advisory only (CFI source); phase decisions come solely from machine inputs; the `fix-epub-context-menu` race protections (`lastEpubSelectionContextRef`, preserve-on-`undefined`) are preserved.
- **[Regression risk on desktop PDF fixed mode]** → its commit/clear architecture is untouched (port-only integration); existing `pdfSelectionPersistence`/`SelectionPopup` tests must pass unchanged.
- **[Sheet lifecycle change alters existing muscle memory (sheet no longer auto-closes when selection clears)]** → intentional (the reported bug); explicit dismiss affordances (Close button, scrim tap, Escape, back-button via `overlayStack`) cover exit paths; scroll no longer closes a *running/result* sheet, matching the comment contract at `DocumentViewer.tsx:1093-1094`.
- **[Three hosts to migrate (DocumentViewer, TranscriptPanel, QueueScrollPage)]** → controller is adopted host-by-host; unmigrated hosts keep current behavior; no big-bang cutover.

## Migration Plan

1. Land `selectionInteraction/` (machine, geometry, adapters) with full unit tests — no behavior change yet.
2. Integrate the controller into `DocumentViewer` behind a settings feature flag (`selectionInteractionV2`, default off): reflow PDF touch path first, then the EPUB/HTML iframe bridge.
3. Add `SelectionActionBar`; wire snapshot-owned sheet open-state and operation staleness.
4. Wire context invalidation (EPUB `relocated`, typography changes, reflow relayout, document switches) and the collateral fixes (tap zones, `isReflowActive`).
5. Migrate `TranscriptPanel` and `QueueScrollPage` onto the controller (deleting their local `selectionchange` duplicates).
6. Consolidate desktop placement (`SelectionPopup` → shared placement helper); run the manual QA matrix; flip the flag default; remove the flag after a soak period.

Rollback at every step = disable the flag; the old paths remain until step 6 completes. No data migrations; no persisted-format changes.

## Open Questions

- Should `SELECTION_STABLE_MS` be raised (e.g. 700 ms) only on detected e-ink devices, or stay uniform? Decide from Palma 2 QA.
- Should the anchored bar also serve touch-capable desktop/tablet hybrid mode, or remain phone/narrow-shell only (current: `useMobileShell()` gate)?
- Do we expose reflow multi-block selections beyond the zero-rect fallback (per-block rects for better `passageAroundSelection` boundaries) now or defer to the canonical phase-8 anchoring work? (Default: defer.)
