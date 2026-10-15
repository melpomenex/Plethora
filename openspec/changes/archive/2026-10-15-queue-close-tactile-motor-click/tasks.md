## 1. Feedback Subsystem Configuration

- [x] 1.1 Register `queue.closed` in `FEEDBACK_EVENT_IDS` and add its payload definition in `src/lib/feedback/events.ts`; verify with `npx vitest run src/lib/feedback/__tests__/policy.test.ts`.
- [x] 1.2 Add the policy for `queue.closed` to `FEEDBACK_POLICY_REGISTRY` in `src/lib/feedback/policy.ts` mapping to `interaction("activation", 150, 10)`; verify policy registry tests pass with `npx vitest run src/lib/feedback/__tests__/policy.test.ts`.

## 2. Mobile Queue Close Interaction Wiring

- [x] 2.1 Add touch-responsive tactile click feedback via `emitUserInteraction("queue.closed")` to the exit button in `src/components/queue/ScrollOverlayControls.tsx`; verify with `npx vitest run src/components/queue/__tests__/ScrollOverlayControls.test.tsx`.
- [x] 2.2 Add tactile feedback to the close button in `src/components/audio/ListenLaterQueue.tsx`; verify component rendering and event dispatch.
- [x] 2.3 Add tactile feedback to `src/components/common/Tabs/TabBar.tsx` when closing a `queue` or `queue-scroll` tab; verify tab closure tests pass with `npx vitest run src/components/common/Tabs/`.

## 3. Verification & Validation

- [x] 3.1 Run full feedback test suite with `npx vitest run src/lib/feedback/__tests__/` to verify event admission, cooldown, and driver dispatch.
- [x] 3.2 Run `openspec validate queue-close-tactile-motor-click --strict` to verify all proposal, spec, design, and task contracts pass validation.
