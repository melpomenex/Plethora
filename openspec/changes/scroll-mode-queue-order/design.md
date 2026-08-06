## Context

Currently, the Queue view features two primary session launcher buttons at the top:
1. "Start Optimal Session" (primary action)
2. "Scroll Mode" (secondary action button)

In the current codebase, both buttons call `onOpenScrollMode()` without parameters, launching `QueueScrollPage` using the default FSRS and variety-mixed algorithm. This creates redundant functionality and makes "Scroll Mode" misaligned with user expectations of scrolling down the Queue list as displayed.

## Goals / Non-Goals

**Goals:**
- Differentiate "Scroll Mode" so it operates directly on the current Queue List's visible items in exact displayed order.
- Preserve "Start Optimal Session" as the FSRS/variety-mixed smart session opener.
- Add intuitive UX subtext, badges, and tooltips to the "Scroll Mode" button explaining that it scrolls through the Queue list order.
- Support both desktop (`ReviewQueueView`) and mobile (`MobileQueueView`) queue views.

**Non-Goals:**
- Changing FSRS algorithms or optimal session calculations.
- Altering document view layouts within `QueueScrollPage` when rendering items.

## Decisions

### Decision 1: Tab Data Passing for Queue Order
Extend `handleOpenScrollMode` in `QueuePage` and `QueueTab` to accept optional session parameters:
```typescript
handleOpenScrollMode(options?: { items?: QueueItem[]; mode?: "queue-list" | "optimal" })
```
Pass `customQueueItems` and `queueScrollMode: "queue-list"` in the tab's `data` payload when opened via the "Scroll Mode" button.

### Decision 2: Sequential Item Construction in `QueueScrollPage`
In `QueueScrollPage`, check if `queueScrollMode === "queue-list"` and `customQueueItems` are present:
- Map `customQueueItems` directly into `ScrollItem[]` matching their explicit list order.
- Skip `applyVarietyMixing` shuffling/reordering when `queueScrollMode === "queue-list"`.

### Decision 3: UX & Micro-Copy Design
Enhance the "Scroll Mode" button in `ReviewQueueView`:
- **Label**: Scroll Mode
- **Subtext**: Queue List Order
- **Tooltip**: Scroll through items in the exact sequence of the Queue List
- **Styling**: Distinct gradient / border styling with Phosphor icons to clearly pair with "Start Optimal Session".

## Risks / Trade-offs

- **Risk**: If the Queue list is empty, launching Scroll Mode in Queue List order might display an empty queue screen.
  - **Mitigation**: Disable or gracefully handle empty states in `ReviewQueueView` and `QueueScrollPage` with clear empty state messaging.
