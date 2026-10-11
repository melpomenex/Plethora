## Context

See [proposal.md](proposal.md) for motivation and scope; [specs/mobile-pull-to-refresh/spec.md](specs/mobile-pull-to-refresh/spec.md) defines the required behavior.

`PullToRefresh` owns the current gesture and indicator states and is mounted in `MobileQueueView`. `MobileDocumentWrapper` also uses it, but has no call sites; the live mobile branch in `DocumentViewerWrapper` renders the reader directly. Document refresh currently has a timer-only fallback. Queue loading and the document wrapper both catch errors, so the pull component's rejection-based failure state does not receive the actual outcome.

The pull recognizer currently checks the nearest `[data-scroll-container]`. Document viewers have different scroll roots, and some use embedded documents where touch events do not bubble to the outer viewer. The integration must preserve the active reader's scroll behavior and position.

An in-progress `native-mobile-haptics` change also covers `PullToRefresh` threshold semantics. This change preserves the existing threshold event and gesture latch behavior.

## Goals / Non-Goals

**Goals:**
- Use one state machine and visual treatment for mobile Queue and live mobile document views.
- Bind document pulls to the active content scroll surface while retaining the current scroll-position contract.
- Give the indicator truthful completion and failure states without changing store-wide refresh semantics.

**Non-Goals:**
- Changing queue ranking, document loading policy, or the desktop experience.
- Adding new haptic effects or another pull gesture recognizer.
- Adding dependencies or persisting refresh state.

## Decisions

### Keep the animation and gesture state in the shared pull-to-refresh component

The shared component will own progress, armed, refreshing, success, and failure visuals. The progress ring follows the resisted pull distance; reaching the threshold completes the ring and changes the affordance to the armed state. On release, it settles into a compact spinner near the top of the content, then briefly shows the result. The indicator stays localized and does not dim or cover the content. This gives Queue and document views the same interaction without duplicating animation state in either surface.

Use app-localized status strings and reduce continuous movement under `prefers-reduced-motion`. Preserve the current threshold feedback event and keep its one-per-gesture behavior under the active haptics work.

### Mount the shared interaction at the live mobile document boundary

Make `MobileDocumentWrapper` the mobile integration boundary from `DocumentViewerWrapper`, instead of changing the unused helper in isolation. Keep the viewer's existing scrolling elements as the scroll containers; do not insert another overflow scroller. The reader host will provide the active scroll roots to the shared gesture controller. Where a reader uses an embedded same-origin document, its touch lifecycle will be forwarded to that controller so pull-to-refresh still starts only when the active content is at its top. Other content types retain their current scroll and selection handling.

The document refresh action will use the existing document hydration path for the active `documentId`, replacing the timer-only fallback. This refreshes the store-backed document record and lets the current viewer update from the hydrated state.

### Normalize outcomes at the surface boundary

Keep the shared component's async contract: a fulfilled refresh means success and a rejected refresh means failure. Because the queue store catches load errors, the Queue adapter will inspect the completed load's error state and reject when loading failed. The document adapter will propagate thrown refresh errors and treat a missing hydrated document as failure. Cleanup such as clearing a refreshing flag remains in `finally`; it must not convert failure into a fulfilled promise.

This boundary approach keeps existing store contracts intact while making the visual result truthful.

### Preserve existing scroll and gesture contracts

The pull gesture remains eligible only for a single downward touch that starts at the active scroll surface's top. A pull below threshold retracts without refreshing. The interaction continues to use the current gesture owner and threshold event; document integration forwards events to that owner instead of creating per-view recognizers. Existing queue virtual-list scroll restoration and document reader scroll positions remain authoritative.

## Risks / Trade-offs

- **[Risk] A document renderer's scroll root or embedded frame may not forward touch events to the viewer host** → *Mitigation:* register each active reader scroll surface with the shared controller and forward embedded-document touch lifecycle events at the renderer boundary.
- **[Risk] The document hydration result may not represent a refresh for every reader type** → *Mitigation:* define the refresh callback per live viewer and only resolve it after the viewer's supported refresh operation completes; do not show a success state for the timer-only placeholder.
- **[Risk] The haptics change and this change edit the same pull component** → *Mitigation:* preserve its threshold event/latch behavior and coordinate integration order when implementation begins.

## Migration Plan

No persisted data or backend migration is required. The new presentation can be rolled back by restoring the current indicator styling and mobile integration while leaving the pull thresholds and haptics behavior unchanged.
