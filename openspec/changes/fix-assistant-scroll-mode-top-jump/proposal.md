## Why

In the Optimal Session Queue (Scroll Mode) and standard Assistant reading views, users reading or interacting with the Assistant panel experience an issue where the conversation viewport abruptly resets its scroll position to the very top—even after the user has explicitly scrolled to the bottom. Approximately 10 seconds after scrolling down, periodic background updates (such as active time tracking, idle updates, and token budget recalculations) trigger layout passes or ResizeObserver callbacks that reset `scrollTop` to 0.

Previous fixes attempted to handle item advance navigation or added conversationId keying, but missed the underlying race condition: when `restorePosition` executes while content layout is unmeasured (`scrollHeight <= clientHeight` or 0), setting `scrollTop = scrollHeight` sets `scrollTop` to 0. This emits an asynchronous browser `scroll` event that the hook's `onScroll` listener captures as an intentional user scroll to `top: 0, follow: false`, corrupting the saved state and locking the view to the top indefinitely.

This change permanently eliminates this failure mode, ensuring the Assistant viewport retains its scroll offset and follow-to-bottom behavior across background re-renders, periodic layout passes, and queue navigation.

## What Changes

- **Guard against unmeasured container layout in `restorePosition`**: In `useAssistantConversationScroll.ts`, avoid applying `container.scrollTop = container.scrollHeight` when `scrollHeight <= clientHeight` or when scrollable dimensions are not yet measurable.
- **Prevent scroll position corruption in `onScroll`**: Discard or ignore scroll capture events when `scrollTop` drops to 0 due to element layout collapse, transient zero-height measurements, or programmatic updates.
- **Anchor element validation**: Validate element bounding boxes before applying relative anchor offsets, preventing missing or unrendered elements from collapsing scroll to offset 0.
- **Preserve bottom-follow mode reliably**: Ensure `follow: true` remains active when the user is scrolled to the bottom, maintaining auto-scroll to the bottom across container resize events and asynchronous content loading.
- **Stabilize conversation keying in `QueueScrollPage`**: Provide explicit, stable conversation keys to `<AssistantPanel>` in `QueueScrollPage` so that asynchronous transitions in `assistantContext` (e.g. from general to document-scoped) do not flap scroll keys and discard saved scroll state.
- **Regression test suite**: Add rigorous tests simulating periodic 10-second background re-renders, container resize callbacks with temporary layout collapse, and scroll preservation at both bottom and mid-scroll anchors.

## Capabilities

### New Capabilities
- `assistant-scroll-stability`: Guarantees persistent, jitter-free scroll position retention in the Assistant conversation panel during user reading, periodic background re-renders, window/element resizing, and queue navigation.

### Modified Capabilities
<!-- None. Spec-level requirements for existing capabilities remain unchanged; this introduces new requirements for conversation scroll stability. -->

## Impact

- **Affected Files**:
  - `src/components/assistant/useAssistantConversationScroll.ts` (scroll measurement, restoration, and event listener guards)
  - `src/components/assistant/AssistantPanel.tsx` (scroll key stability and container ref management)
  - `src/pages/QueueScrollPage.tsx` (explicit conversation identity passing for desktop and mobile queue viewports)
  - `src/components/assistant/__tests__/useAssistantConversationScroll.test.ts` (test coverage for periodic resize and unmeasured layout restoration)
  - `src/pages/__tests__/QueueScrollPage.assistantContext.test.tsx` (integration coverage for scroll retention in queue scroll mode)
- **APIs and Dependencies**: No external API changes; internal React hooks and DOM scroll management only.
