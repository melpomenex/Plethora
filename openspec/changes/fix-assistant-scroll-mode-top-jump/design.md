## Context

See `proposal.md` for the motivation and behavioral impact.

The Assistant panel message scroll position is managed by `src/components/assistant/useAssistantConversationScroll.ts`. The hook:
1. Stores positions in memory and persists them in `sessionStorage` under an `effectiveKey`.
2. Computes an `effectiveKey` combining `sessionKey`, `conversationId`, presentation mode, `paneId`, and `tabId`.
3. Observes the container with a `ResizeObserver` and restores the saved `ScrollPosition` (`top`, `anchorId`, `anchorOffset`, `followingIds`, `follow`).
4. Attaches an `onScroll` listener that calls `capturePosition(container)` when the container scrolls.

When the user is in Queue Scroll Mode (`QueueScrollPage.tsx`):
- Background timers (e.g., active reading tracker every ~10s, capability checks, token budget updates) cause periodic re-renders.
- In `restorePosition`:
  ```ts
  if (position.follow) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  ```
  If the container's layout is temporarily unmeasured or collapsing (`scrollHeight <= clientHeight` or `0`), setting `container.scrollTop = container.scrollHeight` evaluates to 0.
- Setting `scrollTop` to 0 triggers an asynchronous browser `scroll` event.
- The `onScroll` handler runs `capturePosition`. Because `scrollTop` is 0 and subsequent layout expands `scrollHeight > clientHeight`, the hook evaluates `isNearBottom = false` (`follow: false`).
- It captures `{ top: 0, follow: false }` into `positions` and `sessionStorage`.
- The subsequent `ResizeObserver` callback (firing on every periodic re-render) reads this corrupted position and clamps `scrollTop` to 0, permanently trapping the viewport at the top.

## Goals / Non-Goals

**Goals:**
- Eliminate the 10-second scroll jump in Queue Scroll Mode and throughout all Assistant views.
- Ensure `restorePosition` never sets `scrollTop = 0` when `position.follow === true` during unmeasured or zero-height layout states.
- Ensure `capturePosition` in `onScroll` does not corrupt `follow: true` into `top: 0, follow: false` due to programmatic restoration or layout collapse.
- Provide defensive checks on element bounding rectangles before applying anchor offsets.
- Provide a stable conversation identity in `QueueScrollPage` to avoid scroll key fluttering during asynchronous context resolution.
- Verify stability with comprehensive unit and integration tests.

**Non-Goals:**
- Replacing the DOM scroll mechanism with a virtualized message list (e.g. TanStack Virtual).
- Changing Reader or EPUB scroll restoration mechanisms (handled in their respective viewer components).

## Decisions

### Decision 1: Guard `restorePosition` against unmeasured or non-scrollable heights
- **Rationale**: When `position.follow` is `true`, setting `container.scrollTop = container.scrollHeight` only makes sense if `container.scrollHeight > container.clientHeight`. If `container.scrollHeight <= container.clientHeight`, the container is not currently scrollable. Setting `scrollTop` can only produce 0 and trigger an erroneous scroll event.
- **Implementation**:
  ```ts
  if (position.follow) {
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
    return;
  }
  ```
  If the container is not yet scrollable, keep the existing `scrollTop` and let the `ResizeObserver` re-evaluate once the contents finish laying out.
- **Alternatives Considered**:
  - Setting `scrollTop` unconditionally: this is the existing buggy behavior.
  - Delaying restoration with `setTimeout`: flaky across varying device speeds and renders.

### Decision 2: Ignore transient zero scroll events during programmatic restore and layout collapses
- **Rationale**: Programmatic scroll restoration and transient DOM collapses (e.g. during sub-tree re-renders) trigger browser `scroll` events that do not represent genuine user intent.
- **Implementation**:
  Maintain a synchronization ref (`isRestoringRef` or comparing against `expectedScroll`). In `capturePosition`:
  - If `container.scrollHeight <= container.clientHeight`, do not override `follow: true` with `follow: false`.
  - If a scroll event arrives with `scrollTop === 0` while previous state was `follow: true`, verify whether the user actively scrolled upward before revoking `follow`.
- **Alternatives Considered**:
  - Debouncing `capturePosition`: Debouncing does not prevent the zero scroll event from executing if it is the only or final event in the queue.

### Decision 3: Anchor element bounding rect validation
- **Rationale**: When using anchor restoration (`anchorId` and `anchorOffset`), if either the anchor element or the container has a 0-height bounding rectangle (`rect.height === 0` or unattached), calculating `target.getBoundingClientRect().top - container.getBoundingClientRect().top` can produce invalid or negative values that collapse `scrollTop` to 0.
- **Implementation**:
  Check `targetRect.height > 0 && containerRect.height > 0` before applying relative delta. If unmeasured, preserve existing `container.scrollTop`.
- **Alternatives Considered**:
  - Forcing synchronous reflow with `offsetHeight`: Layout measurement during React render commits can cause performance drops without guaranteeing non-zero layout if parents are display-none.

### Decision 4: Stable conversation keying in `QueueScrollPage`
- **Rationale**: In `QueueScrollPage.tsx`, `<AssistantPanel>` was passed no explicit `conversationId` or `conversationKey`, falling back to `context?.conversationId ?? sessionKey`. In Queue Scroll Mode, `assistantContext` can transition asynchronously (e.g. from general placeholder to document-specific context), which flapped `scrollKey` and caused uninitialized scroll positions to be restored.
- **Implementation**:
  Pass an explicit, stable `conversationKey` or `conversationId` tied to the queue item (e.g. `queue-scroll-${currentItem.id}`) and ensure the key remains stable across context enrichment passes.
- **Alternatives Considered**:
  - Keeping default keying and relying only on hook fixes: Fragile because changing `scrollKey` still mounts a fresh scroll record.

## Risks / Trade-offs

- **[Risk] Naturally short conversation with few messages**: A short conversation has `scrollHeight <= clientHeight`. If user adds a message, follow mode must kick in and scroll down.
  → **Mitigation**: When `scrollHeight <= clientHeight`, save `follow: true, top: 0`. When new messages cause `scrollHeight > clientHeight`, the `ResizeObserver` will see `position.follow === true` and execute `container.scrollTop = container.scrollHeight`.
- **[Risk] User deliberately scrolling to top in a scrollable conversation**:
  → **Mitigation**: When `container.scrollHeight > container.clientHeight` and the user scrolls to top (`scrollTop === 0`), `scrollHeight - clientHeight - scrollTop > followThreshold`, so `follow` correctly becomes `false` and `top: 0` is accurately saved.
