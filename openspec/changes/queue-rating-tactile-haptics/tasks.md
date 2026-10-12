## 1. Feedback Subsystem & Event Registry

- [x] 1.1 Register Queue document rating and orb events (`queue.document-rated`, `queue.orb-pressed`, `queue.orbs-docked`, `queue.orbs-drag-threshold`) in `src/lib/feedback/events.ts` and verify type checks pass with `npm run type-check`.
- [x] 1.2 Define feedback policies in `src/lib/feedback/policy.ts` with grade-differentiated haptic effect resolution (`warning` for Again, `commit` for Hard, `success` for Good, `celebration` for Easy, `activation` for Dismiss/Dock, `selection` for press, `threshold` for drag quadrant detent) and verify `src/lib/feedback/__tests__/policy.test.ts` passes.
- [x] 1.3 Implement dynamic grade-to-effect resolution in `src/lib/feedback/orchestrator.ts` for `queue.document-rated` and verify orchestrator unit tests pass via `npm test src/lib/feedback/__tests__/orchestrator.test.ts`.

## 2. Floating Rating Orbs Micro-Interactions

- [x] 2.1 Add pointer-down depression micro-haptics (`queue.orb-pressed`) and drag-out cancel behavior to the Rating Orbs in `src/components/queue/ScrollOverlayControls.tsx` and verify with component interaction tests.
- [x] 2.2 Add magnetic edge-docking proximity detents (`queue.orbs-drag-threshold`) and snap-docking feedback (`queue.orbs-docked`) to the draggable orbs rail in `src/components/queue/ScrollOverlayControls.tsx` and verify with `npm test src/components/queue/__tests__/ScrollOverlayControls.test.tsx`.
- [x] 2.3 Add touch micro-haptics and grade-differentiated feedback to the floating Rating Orbs in `src/components/viewer/DocumentViewer.tsx` for Queue reading mode and verify with viewer tests.

## 3. Queue Document Rating Integration

- [x] 3.1 Emit grade-differentiated tactile feedback (`queue.document-rated`) upon document rating completion in `src/pages/QueueScrollPage.tsx` (supporting both orb clicks and keyboard shortcuts 1-4) and verify with page unit tests.
- [x] 3.2 Wire Queue review session milestone celebrations (multi-document streak intervals and queue cleared) in `src/pages/QueueScrollPage.tsx` and verify milestone feedback emission in tests.
- [x] 3.3 Ensure Dismiss actions in `QueueScrollPage.tsx` and `DocumentViewer.tsx` trigger crisp dismissal tactile feedback and verify dismissal tests.

## 4. Verification & Hardening

- [x] 4.1 Run full test suite covering haptics, viewer, and queue components (`npm test -- src/lib/feedback src/components/queue src/components/viewer src/pages`) and verify all tests pass.
- [x] 4.2 Verify performance benchmark gate via `npm run bench:check` to ensure no regression in bundle size or runtime performance.
