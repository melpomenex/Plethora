## Why

Rating documents in the Queue currently lacks tactile physical confirmation on mobile devices: while flashcard grading emits haptics, rating documents in Queue via the floating Rating Orbs or keyboard shortcuts triggers no motor feedback. Integrating dynamic, grade-differentiated haptic feedback and physical orb micro-interactions transforms Queue document ratings into an immersive, deeply tactile experience that mirrors real physical interfaces.

## What Changes

- Add grade-differentiated tactile haptic signatures to document rating in Queue across all 4 rating grades (Again, Hard, Good, Easy) and Dismissal, giving distinct physical resistance and resonance to each rating choice.
- Add touch-down micro-haptic depression ticks to the Rating Orbs (`pointerdown`/`touchstart`) so pressing an orb feels like physically depressing a glass or mechanical control.
- Add magnetic edge-docking detent haptics when dragging the floating Rating Orbs rail across snap thresholds in `ScrollOverlayControls`.
- Add queue streak and session milestone celebratory haptic sequences when reaching document rating targets in a Queue session.
- Integrate document rating haptic events (`queue.document-rated`, `queue.orb-pressed`, `queue.orbs-docked`) into the centralized feedback orchestrator, policy registry, and admission layer.
- Ensure tactile delivery respects user preferences (`settings.haptics.enabled` and `intensity` levels: subtle, standard, strong) and operates silently when disabled or on unsupported hardware.

## Capabilities

### New Capabilities
- `queue-tactile-orbs`: Tactile micro-interactions for the floating Rating Orbs, including touch-down depression ticks, magnetic drag-and-snap edge docking detents, and milestone celebrations.

### Modified Capabilities
- `document-rating`: Extend document rating requirements to include immediate tactile haptic feedback upon rating submission across both Rating Orbs and keyboard shortcuts.

## Impact

- **Affected Components**: `src/pages/QueueScrollPage.tsx`, `src/components/queue/ScrollOverlayControls.tsx`, `src/components/viewer/DocumentViewer.tsx`.
- **Feedback & Haptics Subsystem**: `src/lib/feedback/events.ts`, `src/lib/feedback/policy.ts`, `src/lib/feedback/orchestrator.ts`, and test suites.
- **Platforms**: Android native, iOS native, and mobile browser/PWA (via `BrowserHapticsDriver`), with graceful no-op on desktop.
