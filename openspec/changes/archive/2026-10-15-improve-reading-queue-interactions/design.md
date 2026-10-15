## Context

The app has multiple Reading Queue implementations. The mobile queue already has a bounded list, swipe actions, and a `useLongPress` hook, but long-press currently enters multi-select mode instead of offering immediate item actions. The primary queue view already computes a strategy-aware `visibleItems` list, supports virtualization, and has desktop context-menu actions, while the legacy route has its own list and menu plumbing. These surfaces do not consistently expose the effective queue order or a touch-friendly action entry point.

The change must reuse the existing queue store, queue API operations, toast system, and document/review navigation. It must not create a second persisted ordering model or require a database migration.

## Goals / Non-Goals

**Goals:**

- Make the effective queue order deterministic and visible on every Reading Queue surface in scope.
- Keep the queue list usable inside the available viewport with touch scrolling and existing virtualization for large queues.
- Add one reusable item-action model that can be opened by long-press on touch devices and by an accessible explicit action control or existing context-menu entry elsewhere.
- Offer only actions valid for the selected item, using existing scheduling and queue mutations.
- Preserve the user’s browsing location when an action refreshes or removes an item.
- Cover gesture cancellation, ordering, action availability, mutation feedback, and keyboard/screen-reader behavior with tests.

**Non-Goals:**

- A user-defined drag-and-drop ordering or a new persisted manual queue priority.
- Changes to FSRS calculations, queue strategy definitions, or session scheduling semantics.
- Replacing the existing desktop context menu or bulk-action bar when the new shared action model can be integrated without changing their current behavior.
- Adding a new UI dependency for menus, sheets, focus management, or virtualization.

## Decisions

### Use the effective queue order as the single displayed order

The queue will display the same strategy-aware order used to determine the next queue item. A shared ordering/positioning helper will apply the active filters first, then preserve the queue strategy’s ranking and use deterministic tie-breakers (existing queue position when available, followed by item ID). Each surface will render a 1-based position and total count from that final visible list.

This is preferred over sorting each surface independently because the current mobile due/priority sort and the primary queue’s smart-queue ordering can disagree. It is also preferred over persisting a new order because the requested behavior is visibility into the computed queue, not manual scheduling.

### Keep scrolling inside the queue list region

The queue header, filters, and primary actions remain available while the item list occupies the remaining viewport and scrolls independently. The mobile list will retain its existing scroll restoration behavior. The primary and legacy list implementations will keep virtualization where already used and add the same bounded overflow behavior around the list rather than rendering an unbounded page.

When an item mutation causes a refresh, the list will restore the previous scroll anchor by item ID when possible; if that item was removed, the nearest remaining item will become the anchor. This prevents postpone/suspend/dismiss actions from jumping the user back to the beginning.

### Share action availability and mutation semantics

Introduce a small queue-item action model/component that derives actions from `QueueItem.itemType` and delegates mutations to existing APIs/store actions:

- documents, extracts, playlist videos, and RSS articles expose open/resume behavior through their existing navigation callbacks;
- learning items expose start review through the existing review callback;
- eligible documents and learning items expose algorithm-aware postpone through `postponeItemSmart`;
- learning items expose suspend, while document-like items expose the existing dismiss/remove-from-active-queue behavior when supported;
- all supported rows expose selection for the existing bulk-action flow.

The long-press sheet will close before a mutation runs, refresh the queue after success, and reuse existing toast/undo feedback. Destructive removal remains explicitly labeled and confirmed where the current operation requires confirmation. Delete remains available through the existing explicit bulk/context-menu flows rather than becoming an accidental one-gesture action.

### Treat long-press as a gesture, with an accessible fallback

Long-press will use the existing hook pattern but open the action sheet instead of immediately selecting the row. Movement beyond the hook’s cancellation threshold, pointer cancellation, and an active list scroll will cancel the gesture. The synthetic click following a completed long-press will be suppressed so it cannot also open the item.

Each row will also expose a visible action button with the same action model, and the sheet will have dialog semantics, a labelled close control, Escape/backdrop dismissal, and focus returned to the invoking row. This makes the feature usable with keyboard, mouse, assistive technology, and devices without reliable long-press support.

## Risks / Trade-offs

- [Risk] A shared order can expose differences between existing queue surfaces. → Mitigation: make the strategy-aware visible list the source of truth and add cross-surface ordering tests with mixed item types and ties.
- [Risk] Touch scrolling can accidentally trigger long-press actions. → Mitigation: cancel on movement/scroll and test slow drags, flings, pointer cancellation, and completed holds separately.
- [Risk] Refreshing after a mutation can still change the ranked list around the user. → Mitigation: restore by stable item ID and fall back to the nearest surviving row; show feedback when the action removes the current row.
- [Risk] Action availability differs by item type and backend support. → Mitigation: derive the action list centrally and hide unsupported mutations instead of exposing controls that cannot succeed.
- [Risk] Long lists can regress performance if position labels or sheets force every row to mount. → Mitigation: keep virtualization for large desktop lists, keep sheet state at the list level, and avoid per-row global listeners.

## Migration Plan

No data migration is required. Rollout is a frontend interaction change using existing queue APIs. If a regression is found, the new action-sheet entry point and position labels can be disabled while retaining the existing row navigation and context-menu actions; no persisted data needs to be rolled back.

## Open Questions

- Confirm during implementation whether RSS articles and playlist videos have a supported dismiss/remove operation; if not, their sheet should expose navigation and selection only.
- Confirm the existing localized strings or add translations for queue position, “Up next,” long-press actions, and action-sheet labels across supported locales.
