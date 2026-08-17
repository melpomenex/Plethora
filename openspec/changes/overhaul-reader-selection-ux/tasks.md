## 1. Selection-interaction core (pure modules, no wiring)

- [x] 1.1 Create `src/components/viewer/selectionInteraction/machine.ts`: states `idle | selecting | settling | ready | actionRunning | resultVisible`, inputs (`selectionChanged(fingerprint, hasText)`, `pointerDown/Up`, `touchStart/End/Cancel`, `contentScroll`, `actionInvoked(snapshot)`, `actionSettled(operationId, outcome)`, `dismiss`, `contextInvalidated(reason)`), text-keyed suppression inputs, and bounded settle/defer constants (`SELECTION_STABLE_MS = 500`, `MAX_DEFER_MS = 3000`) as tunable config. Include the transition table from `design.md` Decision 1, including READY → SELECTING on resumed adjustment and the rule that live-selection events can never demote `actionRunning`/`resultVisible`.
- [x] 1.2 Implement `fingerprintRange(range)` in `src/components/viewer/selectionInteraction/geometry.ts` (start/end container + offset identity, no layout reads) and `captureSelectionGeometry(range, iframeOffset?)` returning viewport-space rect + client-rects union + fingerprint.
- [x] 1.3 Implement `placeAnchoredBar(selectionRect, barSize, viewport, insets)` pure placement: above → below → nearest safe region; clamp to viewport minus safe-area/keyboard insets; never centered over the passage; anchor to the first viewport-intersecting client rect for tall selections.
- [x] 1.4 Unit-test the machine (`selectionInteraction/__tests__/machine.test.ts`) covering the state-transition list from the brief: selection starts → hidden; changes → hidden; stable → shown; changes again → hidden; stabilizes again → shown; action invoked → capture + loading; DOM selection disappears → action continues; success → result visible; failure → error visible; re-adjustment from READY → immediate hide; context invalidation from every phase.
- [x] 1.5 Unit-test placement and geometry (`geometry.test.ts`): top/bottom/left/right/center of viewport, multi-line, taller-than-viewport selection, narrow (Palma 2-class ~330×580 css px) viewport, iframe offset inclusion, keyboard/safe insets — assert output coordinates always inside viewport bounds and never intersecting the selection's anchor rect when avoidable.
- [x] 1.6 Add feature flag `selectionInteractionV2` to the settings store feature flags (default off) for staged rollout and rollback.

## 2. Controller React binding and adapters

- [x] 2.1 Implement `useSelectionInteraction({ surface, documentId, enabled })` in `selectionInteraction/useSelectionInteraction.ts`: owns timers (re-armed settle, defer loop), exposes `{ phase, readySelection, capturedAction, placement }`, imperative `captureForAction()`, `settleNow()`, `invalidate(reason)`, and an `onIframeBridge` registration for iframe surfaces. No React state updates per raw `selectionchange`; transitions only on phase boundaries.
- [x] 2.2 Implement the top-document adapter (generalize `DocumentViewer.tsx:3570-3767`): `selectionchange`/`touchstart`/`touchend`/`touchcancel` (capture) + capture-`scroll` gate via `createScrollDismissGate`, preserving the never-`removeAllRanges()` rule and text-keyed suppression (`isSuppressedSelection`) as machine inputs.
- [x] 2.3 Implement the iframe bridge adapter: subscribe `selectionchange`/`mouseup`/`touchend`/`touchstart` inside a registered content document, transform geometry by `frameElement.getBoundingClientRect()` (pattern from `EPUBViewer.tsx:1204`), forward touch activity, and forward iframe content scrolls to the scroll gate.
- [x] 2.4 Implement rAF-throttled geometry revalidation for the anchored placement: on scroll/resize/`visualViewport` change, re-read the live range only when its fingerprint matches the captured one, else dismiss the anchored UI; never re-anchor a running/result panel.
- [x] 2.5 Unit-test the hook with jsdom + @testing-library (fake timers, dispatched events): settle after touchend + stability, defer-while-touching, suppression re-arm on fresh gesture, reposition-on-scroll once per frame, cleanup on unmount (no leaked listeners/timers).

## 3. Touch action UI (anchored bar + snapshot-owned sheet)

- [x] 3.1 Build `SelectionActionBar` (portal, `position: fixed`, `role="toolbar"` + i18n aria-label): horizontally scrollable compact chips (Summarize, Explain, Ask, Extract, `⋯` overflow); overflow opens the existing `SelectionActionsSheet` in menu mode; ≥44 px targets; placement from `placeAnchoredBar`; transitions disabled under `usePresentation().reducedMotion`; no scrim.
- [x] 3.2 Change `SelectionActionsSheet` open-state ownership in `DocumentViewer`: `open` derives from the controller phase (`ready` bar overflow, `actionRunning`, `resultVisible`) and the existing `aiSheetRequest` desktop path — never from live `mobileSelection.text`/`activeExtractSelection`. Delete the `mobileMenuSheetOpen` live-text coupling (`DocumentViewer.tsx:1079-1088`).
- [x] 3.3 Wire action invocation (bar chip, sheet row, desktop context-menu item) to `captureForAction()`: build the immutable `CapturedSelection` (text, passage via `passageAroundSelection`, `selectionContext` incl. EPUB CFI / PDF canonical context, geometry, documentId, surface, readerContext, `operationId`); AI runs consume only the snapshot.
- [x] 3.4 Guard the empty-selection `hideSelectionUi()` path (`DocumentViewer.tsx:3719-3726`): route it through the machine so it can only demote `selecting/settling/ready` — verify a collapsed selection mid-run never unmounts the running/result sheet (the reported "result disappears" bug).
- [x] 3.5 Add operation staleness to `SelectionActionsSheet`: ignore completions whose `operationId` is not active; abort in-flight requests on `dismiss` and `contextInvalidated`; Retry reuses the snapshot.
- [x] 3.6 Accessibility pass: `aria-busy` + polite live region for streamed results/error announcements, Escape closes and returns focus to the reader container, back-button dismissal via `useOverlayDismissal`/`overlayStack`, i18n keys for all new strings (`selectionBar.*`).

## 4. EPUB surface integration

- [x] 4.1 In `EPUBViewer.tsx`, replace the immediate `onSelectionChange` notification on iframe `selectionchange`/`touchend` (lines 1042-1045, 2530-2557) with registration into the controller's iframe bridge: selection activity drives `selecting/settling`; the parent still receives text+CFI for `readySelection` capture (keep `lastEpubSelectionContextRef` and the preserve-on-`undefined` fix from `fix-epub-context-menu`).
- [x] 4.2 Preserve the existing capture-at-click contract for the desktop right-click menu (`contextmenu` handler 1194-1210 → `ContextMenu`) while routing its actions through the snapshot; verify multi-iframe (continuous manager) coordinate offsets use the event's own iframe, not `querySelector("iframe")`.
- [x] 4.3 Invalidate on context transitions: `relocated` (chapter/page turn), rendition resize/typography changes (`applyRenditionTheme`), and book close → dismiss selection UI, abort in-flight ops, clear stale CFI refs; verify stale menus cannot reappear after a page turn.
- [x] 4.4 Make `ReaderTapZones`' selection guard (`ReaderTapZones.tsx:67-72`) consult the controller instead of the top-level `window.getSelection()` (currently always empty for EPUB).
- [x] 4.5 Tests: jsdom iframe simulation of long-press → drag (multiple selectionchange) → release → settle → bar; collapse-after-invoke continues the AI run; chapter navigation aborts and dismisses; font-size change repositions or dismisses the bar.

## 5. Reflowed + fixed PDF surface integration

- [x] 5.1 Route `PDFViewer` reflow selection (`handleReflowSelection`, 1767-1780; container `onMouseUp` at 4211) through the controller: touch surfaces go through the stability path only; desktop reflow keeps mouse-up semantics; multi-block/multi-page selections anchor on live range geometry (canonical single-page anchor and zero-rect fallback unchanged — `pdfCanonicalReflowSelection.ts`).
- [x] 5.2 Keep fixed-mode architecture intact: feed validated `commitSelection` output into the controller as a `ready` transition; `SelectionPopup`/`SelectionOverlay`/`pdfSelectionPersistence` explicit-clear semantics unchanged; refactor `SelectionPopup.calculatePopupPosition` to delegate to `placeAnchoredBar` (behavioral no-op verified by existing tests).
- [x] 5.3 Invalidate on reflow relayout: typography CSS-var changes (sliders at `PDFViewer.tsx:4416-4426`), reflow regeneration/OCR page replacement, view-mode switches → reposition-from-fresh-geometry or dismiss; expose the real `isReflowActive` signal to `useRecallPrompts` (`DocumentViewer.tsx:1049-1051`).
- [x] 5.4 Tests: reflow selection across blocks/headings/figures settles and anchors correctly; word-span DOM churn during scroll does not re-open UI (suppression); font-width change invalidates placement; fixed-mode popup tests pass unchanged.

## 6. Secondary hosts + shared cleanup

- [x] 6.1 Migrate `TranscriptPanel.tsx` (lines 70-93, 322) onto the controller, deleting its local `selectionchange` duplicate; keep scroll-container scoping via the adapter's content-root registration.
- [x] 6.2 Migrate `QueueScrollPage.tsx` mobile selection path (1842-1922, mount 4443) onto the controller; desktop `mouseup` path unchanged.
- [x] 6.3 Consolidate `DocumentViewer` state: fold `mobileSelection`/`activeSelectionKeyRef`/`dismissedSelectionKeyRef`/`mobileSheetOpenRef` bookkeeping into the controller; `updateSelection` keeps its PDF-validity gating and `lastSelectionRef` semantics for extract flows. (Under the flag the legacy effect is bypassed entirely; the legacy refs remain only as the flag-off rollback path, deleted with 7.8 per the migration plan.)
- [x] 6.4 Regression suite green: existing `SelectionActionsSheet.test.tsx`, `SelectionPopup.test.ts`, `touchSelectionDismissal.test.ts` (migrated assertions), `pdfSelectionPersistence.test.ts`, `pdfTextSelection.test.ts`, `canonicalSelection.test.ts`, `QueueScrollPage` tests — plus new tests proving Summarize, Explain, and Highlight/Extract receive the captured text after live selection collapse. (Full suite: 403 files / 3420 tests green.)

## 7. Manual QA matrix (flag on, then default)

- [ ] 7.1 Android narrow device or emulator (Boox Palma 2-class viewport, ~330 css px wide) — reflowed PDF: long-press → adjust both handles repeatedly → bar only after settle → Summarize → loading/result visible → close; selection near top/bottom/edges; large + small reflow font sizes.
- [ ] 7.2 Android narrow device — EPUB: same flow in scrolled and paginated modes, including chapter turn while a result is open (aborts/dismisses), and font-size change with anchored bar visible.
- [ ] 7.3 Android normal phone — reflowed PDF and EPUB repeat of the core flow; verify native selection handles, magnifier, and system Copy still work alongside.
- [ ] 7.4 Desktop — reflowed PDF and EPUB: mouse select → menu, right-click menu actions, highlight popup (fixed PDF), keyboard Escape dismissal, focus return.
- [ ] 7.5 E-ink mode (or `data-display-mode="eink"` forced): no animation-dependent transitions, no reposition thrash, reduced-motion respected on the bar and sheet.
- [ ] 7.6 Failure path on any platform: disable AI provider → Summarize shows visible error with Retry; retry after re-enabling succeeds without re-selecting.
- [ ] 7.7 Performance spot-check: handle-drag on a large reflowed PDF and a large EPUB produces no per-event renders (React DevTools highlight) and no jank; no polling in performance profiler while idle with a selection active.
- [ ] 7.8 Flip `selectionInteractionV2` default on, soak, then remove the flag and dead code paths.
