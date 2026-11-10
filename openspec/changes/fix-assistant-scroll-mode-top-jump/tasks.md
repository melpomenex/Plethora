## 1. Scroll Engine Safeguards in `useAssistantConversationScroll`

- [x] 1.1 In `src/components/assistant/useAssistantConversationScroll.ts`, guard `restorePosition` to only set `container.scrollTop = container.scrollHeight` when `container.scrollHeight > container.clientHeight`, preventing zero-height scroll collapse when follow mode is active; verify with unit tests in `src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx`.
- [x] 1.2 In `src/components/assistant/useAssistantConversationScroll.ts`, add synchronization guards in `onScroll` to ignore transient zero-scroll events (`scrollTop === 0`) caused by unmeasured layout collapse or programmatic restoration when `follow: true` was active; verify with unit tests in `src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx`.
- [x] 1.3 In `src/components/assistant/useAssistantConversationScroll.ts`, add bounding box validation (`targetRect.height > 0 && containerRect.height > 0`) in anchor-based scroll restoration before calculating relative offsets, preventing unmeasured elements from snapping scroll to top; verify with unit tests in `src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx`.

## 2. Queue Scroll Page Key & Context Stabilization

- [x] 2.1 In `src/pages/QueueScrollPage.tsx`, supply an explicit stable conversation key / ID to `<AssistantPanel>` tied to the active queue item, preventing scroll key flapping during asynchronous `assistantContext` transitions; verify that conversation key remains stable across item context updates.
- [x] 2.2 In `src/components/assistant/AssistantPanel.tsx`, ensure the derived `scrollKey` remains stable when explicit queue/item identifiers are provided; verify by checking `scrollKey` consistency across re-renders in unit tests.

## 3. Automated Verification & Regression Tests

- [x] 3.1 Add comprehensive unit tests in `src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx` covering: (a) preserving bottom follow across periodic resize observer callbacks with transient zero-height collapses, (b) ensuring intentional user scroll to top is still captured correctly when `scrollHeight > clientHeight`, and (c) preserving intermediate anchor positions across mock resize events; verify with `npm run test -- src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx`.
- [x] 3.2 Add integration tests in `src/pages/__tests__/QueueScrollPage.assistantContext.test.tsx` (or a dedicated integration test) verifying that periodic re-renders and queue context updates retain the assistant's scroll position without jumping to top; verify with `npm run test -- src/pages/__tests__/QueueScrollPage.assistantContext.test.tsx`.
- [x] 3.3 Run `npm run bench:check` to verify that no performance benchmark regressions occur.
