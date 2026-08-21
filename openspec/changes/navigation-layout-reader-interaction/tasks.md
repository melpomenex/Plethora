# Implementation Tasks

## 1. Tab strip wheel/trackpad scroll (#6)
- [x] 1.1 Extend `handleTabWheel` in `TabBar.tsx` to handle `deltaX` (native horizontal + Shift+wheel) and translate `deltaY` to horizontal scroll while hovering the strip
- [x] 1.2 Update the capture-phase listener so page scroll is only prevented while the strip has overflow in the gesture direction (release at boundaries)
- [x] 1.3 Verify active tab never changes and tab content never scrolls from wheel events
- [x] 1.4 Test momentum/inertial deltas; verify on Linux (WebKitGTK), macOS, Windows

## 2. First-view loading reliability (#11)
- [x] 2.1 Audit remaining first-open paths (Settings, Queue, Documents, document-viewer, other lazy tabs) for stalls; reproduce any that remain
- [x] 2.2 Fix root causes found (chunk fetch, hydration races, snapshot promises, missed state updates) using existing patterns (`importWithRetry`, `startupStore` watchdog, claim-after-success)
- [x] 2.3 Add development-only first-view latency diagnostics (cold + warm), gated to dev builds
- [x] 2.4 Add/keep regression tests: first visit to Settings, first visit to other lazy views, cold launch, repeat navigation

## 3. Assistant resize → EPUB reflow (#17)
- [x] 3.1 Consume `AssistantPanel.onWidthChange` (or equivalent) in `DocumentViewerWrapper.tsx` and `QueueScrollPage.tsx`
- [x] 3.2 Verify/complete the EPUB ResizeObserver → `rendition.resize` reflow (rAF + debounce), including interaction-suppression behavior
- [x] 3.3 Enforce minimum usable widths for Assistant and reader
- [x] 3.4 Verify position stability, highlight anchoring, and no chapter jumps across repeated resizes

## 4. Tests
- [x] 4.1 Tabs: mouse wheel, Shift+wheel, trackpad horizontal, scroll boundaries, active tab unchanged, content not scrolled
- [x] 4.2 Navigation: first visit to Settings, first visit to other lazy views, cold launch, warm repeat
- [x] 4.3 Assistant/EPUB: drag narrow, drag wide, current position maintained, selection/highlight maintained, repeated resizing, Scroll Mode parity
- [x] 4.4 Run `npm run test:run` affected suites; run `npm run bench:check` if EPUB/tab hot paths change

## 5. Spec
- [x] 5.1 Confirm spec files match implementation