## Why

The Reading Queue does not make the upcoming reading order obvious, and queue items do not offer a convenient touch interaction for item-level actions. This makes it harder to scan what is next, especially on mobile, and forces users into separate controls or bulk-selection flows for common queue management tasks.

## What Changes

- Present queue items in a stable, explicit order based on the queue’s computed priority, with a visible ordinal position for each item.
- Make the queue list scrollable within the available Reading Queue surface so users can browse the complete queue without losing the surrounding controls.
- Add a long-press interaction for queue items that opens an item action sheet.
- Provide context-appropriate actions from the long-press sheet: open/resume the item, start review for learning items, postpone eligible items, suspend or dismiss the item from the active queue, and enter bulk selection when appropriate.
- Preserve existing destructive-action safeguards and show clear success/failure feedback, including undo where the existing queue flow supports it.
- Keep ordinary tap behavior focused on opening or starting the selected item, and ensure long-press does not trigger that tap accidentally.

## Capabilities

### New Capabilities

- `reading-queue-browse`: Ordered, scrollable Reading Queue browsing with visible queue positions and long-press item actions.

### Modified Capabilities

- None.

## Impact

- Affected queue surfaces: `src/components/mobile/MobileQueueView.tsx`, `src/components/review/ReviewQueueView.tsx`, and the legacy queue route where its list behavior is still exposed.
- Affected queue state and action plumbing: `src/stores/queueStore.ts`, `src/api/queue.ts`, and existing queue action/context-menu components.
- Affected interaction and accessibility coverage: long-press/tap gesture handling, scroll containers, action-sheet focus management, visible queue rank labels, and localized action text.
- No database migration or new external dependency is expected.
