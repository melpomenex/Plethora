## Why

On mobile, the app's back navigation can be invoked by a horizontal swipe that begins anywhere on the screen. This makes ordinary horizontal interactions—such as scrolling the Library view—unexpectedly navigate away from the current tab. The back gesture needs to follow the expected mobile convention: it is eligible only when the touch begins at the left screen edge and travels inward far enough to be intentional.

## What Changes

- Restrict the mobile back-swipe recognizer to touches that originate within a small, explicit left-edge activation zone.
- Remove global horizontal tab-navigation gestures, including full-width tab cycling and right-edge forward navigation, so horizontal movement belongs to the active view.
- Keep horizontal gestures that begin in the body of the screen available to the active view, including Library horizontal scrolling and other in-content swipe interactions.
- Preserve the existing protections for vertical scrolling, controls, dialogs, editable fields, and other gesture-owned content.
- Add regression coverage for qualifying edge gestures, non-edge horizontal swipes, vertical movement, and excluded targets.

## Capabilities

### New Capabilities

- `mobile-edge-back-gesture`: Defines the mobile back-navigation gesture boundary and its coexistence with ordinary in-content horizontal gestures.

### Modified Capabilities

## Impact

- Mobile gesture handling in `src/hooks/useEdgeSwipeBack.ts` and its integration in `src/components/mobile/MobileLayoutWrapper.tsx`.
- Shared gesture-exclusion behavior in `src/lib/gestureTargets.ts` if the audit identifies an overlapping global handler.
- Unit tests under `src/hooks/__tests__/`, with mobile/manual verification of Library horizontal scrolling and edge-back navigation on native mobile builds.
- No backend, persistence, or public API changes.
