## Context

Plethora has an established haptics and feedback subsystem in `src/lib/feedback/`:
- A typed event vocabulary in `src/lib/feedback/events.ts`.
- A centralized policy registry in `src/lib/feedback/policy.ts`.
- A feedback orchestrator and admission governor (`orchestrator.ts`, `admission.ts`).
- First-party native mobile drivers:
  - Android (`src-tauri/plugins/plethora-haptics/android/`): Maps the `"activation"` semantic effect to `HapticFeedbackConstants.CONTEXT_CLICK`, which drives the rotary/mechanical tactile motor click on Android devices.
  - iOS (`src-tauri/plugins/plethora-haptics/ios/`): Maps the `"activation"` effect to `UIImpactFeedbackGenerator(.soft | .light | .medium)`.
  - Mobile web / PWA (`BrowserHapticsDriver.ts`): Delivers a crisp 10ms vibration pulse via `navigator.vibrate`.

Queue closing primarily occurs in `src/components/queue/ScrollOverlayControls.tsx` where users tap the top-bar "x" button to exit full-screen Queue Scroll Mode back to the previous screen. Additional mobile queue close touchpoints include `src/components/audio/ListenLaterQueue.tsx` (the "Close queue" modal button) and `src/components/common/Tabs/TabBar.tsx` (compact tab close for queue tabs).

See `proposal.md` for motivation and `specs/queue-close-tactile-click/spec.md` for behavior requirements.

## Goals / Non-Goals

**Goals:**
- Provide an immediate, satisfying tactile motor click when the user taps on the "x" button to close out the Queue on mobile touch devices.
- Route the interaction through Plethora's centralized feedback subsystem using a dedicated `queue.closed` event.
- Map the event to the semantic `"activation"` haptic effect (tactile motor click).
- Provide instantaneous touch confirmation on `pointerdown` to feel like depressing a physical mechanical button.
- Honor user preferences (`settings.haptics.enabled`, `intensity`) and gracefully no-op on desktop or unsupported devices.

**Non-Goals:**
- Adding sound effects or audio beeps to the queue close interaction (it remains purely tactile and non-intrusive).
- Altering queue progression, FSRS ratings, or tab navigation lifecycles.
- Modifying general desktop window or dialog closing behavior.

## Decisions

### 1. Dedicated `queue.closed` Feedback Event
Add `queue.closed` to `FEEDBACK_EVENT_IDS` in `src/lib/feedback/events.ts` and define its policy in `src/lib/feedback/policy.ts`:
```typescript
"queue.closed": interaction("activation", 150, 10),
```
- **Rationale**: The semantic effect `"activation"` maps directly to `HapticFeedbackConstants.CONTEXT_CLICK` on Android and `UIImpactFeedbackGenerator` on iOS, creating the exact rotary/motor tactile click desired. The `interaction` policy helper ensures it is purely tactile (`toast: "never"`, `sound: null`, `haptic: true`), with a 150ms cooldown to eliminate double-firing.
- **Alternatives considered**:
  - Reusing `navigation.back-completed`: Rejected because `navigation.back-completed` uses the `"selection"` effect (a soft tick) rather than the stronger, more satisfying tactile motor click of `"activation"`.
  - Reusing `interaction.context-activated`: Rejected because closing a queue is a distinct domain action, not context activation.
  - Directly calling `hapticsService.perform()`: Rejected because it bypasses policy-based enablement, admission cooldowns, and the central test harness.

### 2. Touch-Down Responsive Feedback in `ScrollOverlayControls.tsx`
In `src/components/queue/ScrollOverlayControls.tsx`, enhance the exit button:
```tsx
<button
  onClick={onExit}
  onPointerDown={() => emitUserInteraction("queue.closed")}
  className="p-2 rounded-lg bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors"
  title={labels?.exit ?? "Exit scroll mode"}
>
  <X className="w-5 h-5 text-white" />
</button>
```
- **Rationale**: On mobile touchscreens, firing feedback on `onPointerDown` gives immediate mechanical confirmation the instant the user's thumb touches the button, rather than suffering latency until `pointerup` or `click`. The 150ms policy cooldown protects against duplicate admission if `onClick` also runs.

### 3. Mobile Close Points in `ListenLaterQueue.tsx` and `TabBar.tsx`
Apply the same `queue.closed` feedback pattern to:
- `src/components/audio/ListenLaterQueue.tsx`: The close button with `aria-label="Close queue"`.
- `src/components/common/Tabs/TabBar.tsx`: Closing a tab whose type is `"queue"` or `"queue-scroll"`.

## Risks / Trade-offs

- **[Risk] Rapid duplicate triggers on tap (pointerdown followed by click)**:
  → *Mitigation*: The feedback policy assigns a 150ms cooldown to `queue.closed`, guaranteeing that rapid successive events within the touch lifecycle are admitted at most once.

- **[Risk] Accidental touch cancellations or drags**:
  → *Mitigation*: The close button in `ScrollOverlayControls` is isolated in the top navigation bar with explicit tap target bounds. Emitting on press provides immediate responsive feedback matching standard mobile button click paradigms.
