## Why

The Queue's item Details popover (`src/components/common/ItemDetailsPopover.tsx`) currently shows tags as static, read-only pills — there is no way to add or remove a tag without leaving the Queue and opening the document/extract editor. There is also no way to discover "everything else tagged like this" from the Queue: clicking a tag does nothing. Tag editing already exists elsewhere in the app (`EditExtractDialog`, `DocumentsView`) but was never wired into the Queue's Details popover, so reviewers who want to correct or enrich tags mid-session have to break their review flow. This change closes that gap and rounds out the Details popover with the other common per-item actions reviewers reach for elsewhere (postpone, dismiss, delete) so it becomes a single place to manage an item during review.

## What Changes

- Add inline tag editing to `ItemDetailsPopover`: remove a tag with a click (× on the pill), add a tag via a small input with autocomplete suggestions drawn from the item's existing tag vocabulary, for `document`, `extract`, and `learning-item` target types (RSS targets keep read-only display, since RSS tagging is a separate relational system).
- Wire tag edits to the existing `update_document` / `update_extract` / `update_learning_item` Tauri commands (same ones `EditExtractDialog`/`DocumentsView` already use) so no new backend tag-mutation command is needed.
- Add a "view items with this tag" affordance: clicking a tag pill (in view mode, not the × remove target) opens a modal listing every document/extract/learning-item that carries that tag, grouped by type, each entry clickable to navigate to/open that item.
- Add a compact "common actions" row to the Details popover surfacing the actions already available elsewhere in Queue (postpone, dismiss/undismiss, delete) so users don't need to close the popover and hunt for the context menu to act on the item they're already inspecting.
- Optimistic UI updates for tag add/remove with toast-based error rollback on failure, consistent with existing patterns in `DocumentsView.tsx`.

## Capabilities

### New Capabilities
- `queue-item-tag-management`: Inline tag add/remove editing and a "browse by tag" modal, scoped to the Queue item Details popover.

### Modified Capabilities
- (none — no existing spec covers `ItemDetailsPopover`; this is net-new spec coverage, not a change to prior documented requirements)

## Impact

- `src/components/common/ItemDetailsPopover.tsx` — add tag edit UI, tag-click handler, common-actions row.
- New component: tag-filter modal (e.g. `src/components/common/TagItemsModal.tsx`), built on the existing `src/components/common/Modal.tsx` singleton pattern.
- New/shared frontend helper to query "all items with tag X" across documents/extracts/learning-items (no existing cross-type tag lookup; likely a new lightweight Tauri command or three parallel calls to existing list endpoints filtered client-side — decided in design.md).
- `src/api/documents.ts`, `src/api/extracts.ts`, `src/api/learning-items.ts` — reuse existing update calls; no schema changes (tags remain the JSON string-array columns from `001_initial.sql`).
- Queue action wiring: reuse `postponeItemSmart`, dismiss/undismiss, and delete logic already present in `QueueContextMenu.tsx` / `useQueueStore`, invoked from the popover.
- i18n: new strings under `itemDetails.*` for tag input, tag modal, and action labels.
