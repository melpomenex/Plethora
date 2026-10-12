## Why

Closing out the Queue on mobile currently lacks physical tactile confirmation: when a user taps the "x" button to close or exit the Queue on mobile devices (such as exiting Queue Scroll Mode or closing queue modals), the transition occurs visually without any motor sensation. Introducing a crisp, satisfying tactile motor click makes closing the Queue feel physically responsive, deliberate, and satisfying on handheld touchscreens.

## What Changes

- Add a dedicated feedback event `queue.closed` to the centralized feedback subsystem (`events.ts` and `policy.ts`) mapped to the semantic `"activation"` haptic effect (platform tactile motor click: `HapticFeedbackConstants.CONTEXT_CLICK` on Android, UIImpactFeedback on iOS, brief vibration pulse on PWA).
- Connect the close ("x") button in mobile Queue surfaces—principally the exit button in `ScrollOverlayControls` (exiting full-screen Queue Scroll Mode) and the close button in `ListenLaterQueue` / compact tab close—to trigger the tactile motor click on tap / pointer down.
- Ensure the tactile motor feedback runs through the feedback orchestrator and admission governor, honoring user settings (`haptics.enabled`, `haptics.intensity`), cooldowns, and non-blocking delivery.

## Capabilities

### New Capabilities
- `queue-close-tactile-click`: Emits a tactile motor click when the user taps the close ("x") button on mobile Queue surfaces.

### Modified Capabilities

## Impact

- **Affected UI Components**: `src/components/queue/ScrollOverlayControls.tsx`, `src/components/audio/ListenLaterQueue.tsx`, `src/components/common/Tabs/TabBar.tsx`.
- **Feedback & Haptics Subsystem**: `src/lib/feedback/events.ts`, `src/lib/feedback/policy.ts`, and corresponding policy/orchestrator test suites.
- **Platforms**: Android native (Tauri), iOS native, and mobile browser / PWA.
