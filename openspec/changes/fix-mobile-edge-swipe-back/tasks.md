## 1. Audit Gesture Ownership

- [x] 1.1 Trace every mobile touch handler and `requestApplicationBack` call site to confirm which path currently dispatches back for horizontal gestures.
- [x] 1.2 Verify that `useEdgeSwipeBack` is the sole global gesture path that requests application back, and that full-width tab cycling continues to exclude edge-origin touches.

## 2. Enforce the Left-Edge Boundary

- [x] 2.1 Update or confirm `useEdgeSwipeBack` so only a single touch that begins within the configured left-edge activation zone is tracked for the entire touch sequence.
- [x] 2.2 Ensure tracked gestures require inward horizontal intent and minimum travel, while vertical-dominant, outward, short, multi-touch, and cancelled sequences are abandoned without requesting back.
- [x] 2.3 Preserve target exclusions and apply `preventDefault` only after an eligible horizontal edge gesture is established; update `MobileLayoutWrapper` or `gestureTargets` only if the audit finds an overlapping path.
- [x] 2.4 Remove the mobile-shell registrations for full-width tab cycling and right-edge forward navigation so no global left swipe changes the active view.

## 3. Add Regression Coverage

- [x] 3.1 Extend `src/hooks/__tests__/useEdgeSwipeBack.test.tsx` to cover a qualifying left-edge inward gesture, including exactly-once back dispatch.
- [x] 3.2 Add tests proving a mid-screen horizontal swipe does not request back, including a swipe that later crosses into the edge zone.
- [x] 3.3 Add tests for vertical movement, insufficient or outward travel, multi-touch/cancel, and protected controls or gesture-owned targets.
- [x] 3.4 Verify the mobile shell no longer registers full-width tab cycling or right-edge forward navigation; the existing wrapper back tests continue to cover native back dispatch.

## 4. Verify Mobile Behavior

- [x] 4.1 Run the targeted gesture tests and the project's applicable typecheck/lint or frontend test commands.
- [ ] 4.2 On representative native Android and iOS builds, verify that a left-edge inward gesture navigates back while Library horizontal scrolling and other mid-screen horizontal interactions remain in place.
- [x] 4.3 Verify fullscreen reading, dialogs, editable controls, and vertical scrolling retain their existing gesture behavior.
