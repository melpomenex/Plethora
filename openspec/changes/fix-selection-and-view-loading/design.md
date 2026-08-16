## Context

Four independent defects, one change. All are frontend (React/TS/CSS); no Rust, schema, or dependency changes.

1. **Desktop PDF right-click does nothing.** EPUB reaches the shared `ContextMenu` via `EPUBViewer`'s iframe `contextmenu` listener → `onContextMenu` prop → `setContextMenuState` (`DocumentViewer.tsx:6940`), rendered at `DocumentViewer.tsx:7801` behind a `docType !== "pdf"` gate. `PDFViewer` has no `contextmenu` listener and no `onContextMenu` prop, and the render gate would suppress the menu even if state were set. The HTML/OCR-HTML iframe listener (`attachHtmlIframeContextMenuListener`, `DocumentViewer.tsx:5689`) is dead code for OCR-mode PDFs because of the same gate.
2. **Mobile PDF toolbar hugs the edges.** The app shell applies `env(safe-area-inset-*)` once at `.adaptive-shell-root` (`src/index.css:677-689`, exposed as `--shell-safe-left/right`), but the PDF reader toolbar (`PDFViewer.tsx:3926`, `p-1` = 4px) and DocumentViewer's mobile compact toolbar (`DocumentViewer.tsx:5910-6045`, `p-2` = 8px) add nothing themselves. EPUB's floating pill header keeps 12px clearance (`mx-3 mt-3`); PDF is the only in-flow mobile header with no edge/safe-area padding, so the original/reflow toggle and the right-hand zoom cluster sit flush against the screen edge (and against the notch in landscape).
3. **Reflowed-PDF selection can't be dismissed on touch.** On touch shells the native selection is deliberately never cleared programmatically (clearing it while Android's selection action mode is up wedges the WebView — `DocumentViewer.tsx:1308-1313`). Dismissal relies on a guard keyed by `${text.length}:${anchorOffset}:${focusOffset}` with a 2500ms window. In reflow mode, scrolling mutates the DOM around the live selection (lazy `[data-pdf-reflow-page]` sections append, offsets shift), firing `selectionchange`, which re-arms the 500ms stability timer and re-opens the sheet. Offset-keyed suppression can't survive DOM churn, and nothing dismisses on scroll.
4. **First view activation renders empty until re-visited.** Tabs are keep-alive (`TabContent.tsx`): navigating away/back flips `ActiveTabContext`; it does not remount. First-mount loads race the startup snapshot hydration of `activeCollectionId`: `DocumentsView`'s load effect (`DocumentsView.tsx:330-333`) omits `activeCollectionId` from deps, so it fetches with the placeholder id, and `documentStore.loadDocuments` discards stale responses when the id flips mid-flight — nothing re-triggers. Desktop `ReviewQueueView` claims `loadedQueryKey` before data arrives (`ReviewQueueView.tsx:336`), so a watchdog-null `ensureStartup` (8s) plus a stalled fallback leaves the view stuck; later activations early-return. `invokeCommand` caches a rejected `backendReadyPromise` forever (`lib/tauri.ts`, `??=`), making every subsequent invoke fail until restart. Commit `337988a8` fixed the mobile-queue variant of this; these are the remaining surfaces.

## Goals / Non-Goals

**Goals:**
- Right-click on a desktop PDF selection (fixed, reflow, and OCR-HTML modes) shows the same `ContextMenu` EPUB shows, with valid PDF provenance for extract/highlight actions.
- Mobile PDF toolbars keep comfortable edge clearance in portrait and landscape (notch) without regressing the auto-hide chrome.
- On touch, scrolling the reflowed PDF (or tapping the scrim / tapping away) dismisses the actions sheet, and a dismissed selection cannot re-open the sheet by itself.
- Queue and Documents load correctly on first activation, including when the startup snapshot lands after mount; a failed backend-readiness probe doesn't poison all future invokes.

**Non-Goals:**
- Adding new actions to the desktop menu (Ask library / Socratic tutor / Prerequisites stay mobile-sheet-only) — the requirement is parity with the existing EPUB desktop menu.
- Clearing native selections programmatically on touch (Android WebView wedge invariant stays).
- Changing the reflow scheduler, lazy-loading strategy, or tab keep-alive architecture.
- iOS-specific safe-area verification beyond the CSS mechanism (Android is the reference mobile target; `viewport-fit=cover` + edge-to-edge are already configured).

## Decisions

### D1. PDF context menu: mirror the EPUB prop contract; fix the gate for all PDF view modes

Add `onContextMenu?: (payload: {x, y, selectedText, selectionContext}) => void` to `PDFViewer`, the same shape `EPUBViewer` already uses, and wire it in `DocumentViewer`'s PDFViewer render to `setContextMenuState`. In `PDFViewer`, register one top-level-document `contextmenu` listener alongside the existing mouseup/mousedown selection handlers (`PDFViewer.tsx:2644-2758`): PDF text layers and the reflow DOM live in the top document, so `e.clientX/clientY` need no iframe offset translation (unlike EPUB). On right-click: if a committed, valid selection exists (`persistedSelection` + `selectionAnchorsInTextLayers`, or the reflow `PdfSelectionContext`), `preventDefault()` and emit with the **committed `PdfSelectionContext`** — not raw DOM text — so `buildContextMenuItems`' extract/highlight payload builders get provenance that passes `buildPdfSelectionExtractPayload` validation. If no selection exists, let the default menu through.

Change the render gate at `DocumentViewer.tsx:7801` from `docType !== "pdf"` to allow `docType === "pdf"` in all view modes: native and reflow get the new listener; OCR-HTML already attaches `attachHtmlIframeContextMenuListener` (its listener becomes live instead of dead). Hide the floating `SelectionPopup` while the context menu is open (right-click menu supersedes the mouseup popup).

*Alternative considered:* building a PDF-specific menu component — rejected; `buildContextMenuItems` + `ContextMenu` already handle platform branching (desktop floating vs mobile sheet) and all action handlers.

### D2. Toolbar spacing: CSS-only clearance via `max(safe-area, minimum)`

In `PDFViewer.css` (inside the existing `@media (max-width: 767px)` block), set the toolbar's horizontal padding to `max(env(safe-area-inset-left, 0px), 12px)` / right equivalent (the toolbar's own `p-1` becomes vertical-only on phones). Do the same for DocumentViewer's mobile compact toolbar (its `p-2` grows to `max(env(...), 12px)` horizontally, ideally via a shared utility class in `index.css` next to the existing `.safe-*` helpers, e.g. `.safe-x-pad`, so both headers and future in-flow mobile toolbars reuse it). Using `max()` keeps clearance correct whether or not an ancestor already consumed the inset (fullscreen, embedded surfaces) and guarantees the 12px minimum in portrait where insets are 0. No JS/layout changes; the auto-hide translate and gear popover (`absolute right-2`) keep working because they key off the toolbar box.

*Alternative considered:* consuming `--shell-safe-left/right` directly — rejected as sole mechanism because those variables are only applied on specific shell roots (`:root[data-presentation="phone"]` etc.); `env()` in `max()` is self-contained and equally supported in the Android WebView / WKWebView targets.

### D3. Touch dismissal: scroll-dismisses + text-keyed suppression cleared by fresh gestures

Two coordinated changes, both in `DocumentViewer` (the sheet owner):

1. **Scroll dismisses.** Scroll events don't bubble but do fire in capture phase: add a `scroll` listener with `capture: true` on the `data-document-content` wrapper (covers the PDF reflow/fixed scroll containers and EPUB host) in the existing mobile selection monitor effect (`DocumentViewer.tsx:3562-3712`). On scroll past a small threshold (~8px, so micro-jitter doesn't dismiss), close the sheet, clear `mobileSelection`, and record the dismissal (below). App-level state only — the native selection is left untouched per the Android invariant. This matches user expectation (EPUB paging already effectively dismisses) and matches the fixed-mode desktop behavior where scroll hides the selection popup (`PDFViewer.tsx:3716-3724`).
2. **Suppress by text, not offsets.** Change the dismissal guard from the exact `${text.length}:${anchorOffset}:${focusOffset}` key + 2500ms window to **text-equality suppression with no short expiry**: after dismissal, any stability-gated selection whose text equals the dismissed text stays suppressed until (a) the native selection actually collapses (existing `hideSelectionUi` path resets suppression), or (b) a fresh selection gesture starts — `touchstart`/`mousedown` inside the content wrapper clears suppression, so deliberately re-selecting the same passage re-opens the sheet. Text equality survives the offset shifts caused by reflow DOM churn; offsets were the reason the old guard failed.

*Alternative considered:* lengthening the 2500ms window and keeping offset keys — rejected; reflow churn changes offsets arbitrarily and any finite window re-opens the sheet on later scrolls, which is the reported bug.

### D4. View loading: re-trigger on collection hydration; claim keys after success; un-poison readiness

- **Documents:** include `activeCollectionId` (from `useCollectionStore`) in the load effect deps, and derive a `loadKey` like the queue does so switching collections while the tab is active reloads. `documentStore.loadDocuments`' stale-response discard stays as-is (it becomes correct once re-triggering exists). This heals both orders of the race: snapshot-before-mount and snapshot-after-mount.
- **Desktop queue:** move `setLoadedQueryKey(loadKey)` from before the load to **after a load path resolves successfully** (`ensureStartup` snapshot non-null, or `loadDueQueueItems` completion). Coalescing of rapid re-entries is already handled by `dedupeLoad`, which the up-front claim was duplicating. Add the mobile view's self-retry-with-backoff when the snapshot resolves null (watchdog case), so a slow first IPC/migration doesn't strand the view.
- **Transport:** in `lib/tauri.ts`, reset the cached `backendReadyPromise` to `null` when the readiness probe exhausts its attempts, so the next `invokeCommand` re-probes instead of failing instantly forever. The existing 5×5s probe cadence bounds retry cost.

*Alternative considered:* replacing the store effects with React Query — rejected for this change; a lifecycle rewrite is higher risk than fixing the trigger/claim semantics inside the current architecture.

## Risks / Trade-offs

- [Right-click inside a text-layer selection may conflict with the mouseup `SelectionPopup`] → Hide `SelectionPopup` whenever `contextMenuState` is open; both derive from the same committed selection so they can't diverge.
- [Text-keyed suppression could swallow a deliberate re-selection of identical text] → Fresh `touchstart`/`mousedown` in content clears suppression before the stability timer can fire; only churn-driven `selectionchange` (no new gesture) stays suppressed.
- [Capture-phase scroll listener could dismiss the sheet during scroll-into-view triggered by the sheet itself] → Only dismiss on user-scroll gestures past the threshold; the sheet locks body scroll while open, so remaining scrolls originate from the reader containers, which is exactly the dismissal intent.
- [`max(env(), 12px)` narrows usable toolbar width on small landscape screens] → The toolbar already scrolls horizontally (`overflow-x-auto`); 12px is the same clearance EPUB's pill header uses.
- [Claim-after-success may double-load on rapid tab toggling] → `dedupeLoad` coalesces concurrent loads; worst case is one redundant invoke, strictly better than a permanently stuck view.
- [Readiness re-probe could retry-storm a crashed backend] → Probe cadence unchanged (5s × 5 per cycle); each `invokeCommand` attempt re-probes at most once per failed cycle.

## Migration Plan

Frontend-only; ship as a single commit on `main`. Rollback = revert. No data or settings migrations. Existing tests around selection persistence, startup stall, and mobile queue startup (`MobileQueueView.startup.test.tsx`, `startupStore.stall.test.ts`, `pdfMobileFoundation.test.ts`) pin the adjacent invariants and must keep passing.

## Open Questions

None blocking. (During review, confirm the gear popover and extract FAB spacing on the compact toolbar still clear the new padding on a 360dp-wide device.)
