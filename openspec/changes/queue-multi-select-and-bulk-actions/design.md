## Context

The queue already has most of the plumbing this change needs; what is missing is the
layer that lets a user *build* a selection and the breadth of actions to spend it on.

Current state, verified:

- `queueStore.ts` holds `selectedIds: Set<string>` (`:94`), `setSelected` (`:323`),
  `selectAll` (`:335`), `clearSelection` (`:345`), and `bulkSuspend` / `bulkUnsuspend` /
  `bulkDelete` (`:713`, `:738`, `:762`).
- `selectAll` is subtly wrong for this change: it filters to
  `item.itemType === "learning-item"` (`:337`), so documents and extracts are silently
  unselectable via select-all.
- `applyItemDelta` (`:365`) patches one item per call with a full `items.map()`. Calling
  it 200 times for a bulk action is 200 array copies plus 200 `applyFilters()` runs.
- `queue_bulk.rs` already has `resolve_queue_entities`, which maps an ambiguous queue id
  to `LearningItem | Document | Extract`, plus `BulkOperationResult { succeeded, failed,
  errors }` (`:25`). Commands registered in `lib.rs`: `bulk_suspend_items`,
  `bulk_unsuspend_items`, `bulk_delete_items`, `bulk_set_document_priority`,
  `bulk_move_documents_to_collection`, `bulk_delete_documents`, `bulk_delete_extracts`,
  `bulk_generate_cards`.
- `BulkActionBar.tsx` exists (91 lines), is mounted at `routes/queue.tsx:418`, and
  offers suspend / unsuspend / delete as a `sticky top-0` banner.
- `DocumentViewer.tsx` declares `isExtractMode` (`:418`) and reads it in exactly four
  places, all cosmetic: `:5988`, `:5992`, `:5996` (button styling) and `:6313` (cursor).
  `setIsExtractMode` has one caller — the button's own `onClick` (`:5985`).

Constraints: Tauri v2 bundles with `inlineDynamicImports: true`, so there is no code
splitting to hide new UI behind. No new dependencies. The queue list renders in two
surfaces — `routes/queue.tsx` and `ReviewQueueView.tsx` — which must not diverge.

## Goals / Non-Goals

**Goals:**

- One selection model, owned by `queueStore`, driving both queue surfaces.
- One IPC round trip per bulk action regardless of selection size.
- Optimistic patching that reuses the store's existing `hasLocalDeltas` /
  `reconcileIfDirty` contract rather than inventing a second reconciliation path.
- Make the Extract Mode toggle actually gate extraction, at the shared selection
  handler rather than per viewer.
- Reuse `resolve_queue_entities` and `BulkOperationResult` for all new Rust commands.

**Non-Goals:**

- Re-implementing the twelve PRD items already shipped on `main` — enumerated with
  evidence in `proposal.md`. This change does not touch them.
- Changing occlusion region coordinates from percent to normalized `[0.0, 1.0]`. That
  would invalidate every stored region for no behavioral gain.
- Building `computeOptimalQueue`. It does not exist; `ReviewQueueView.tsx:418-424`
  already enforces `itemTypes` as a hard post-filter.
- Drag-to-select, rubber-band selection, or persisting a selection across app restarts.
- Virtualizing the queue list. Out of scope even though it would raise the ceiling on
  large-selection rendering.

## Decisions

### Selection anchor is an item id, and callers supply their own rendered order

`lastSelectedId: string | null` lives in `queueStore` next to `selectedIds`.

*Revised during implementation.* The original decision was a `lastSelectedIndex` into
`filteredItems`. That is wrong here: `ReviewQueueView` renders `visibleItems` (`:404`),
which layers session-customization filters on top of `filteredItems`, so a store-owned
index addresses a different row depending on which surface asked. The signature is
therefore `setSelectionFromClick(id, renderedIds, mods)` — the store owns the anchor and
the semantics, each surface passes its own visible row order. The `indexOf` per click is
O(n) on a list that is already O(n) to render.

*Alternative rejected:* deriving the range in the component from its own render list.
That splits selection state across two owners and guarantees the queue surfaces drift
apart — which is exactly what had already happened: `ReviewQueueView` carried a private
ref-based range implementation (`:920-941`) that the other two surfaces never got, and
which only ever worked on learning items.

### Shift + Click unions onto a base snapshot, not the live selection

`selectionBase: Set<string>` records the selection as it stood when the anchor was last
set. `Shift + Click` computes `base ∪ [anchor..clicked]`.

*Why:* two spec requirements pull in opposite directions. Successive shift-clicks must
*shrink* the range when pivoting back toward the anchor, but a shift-click after a
`Cmd + Click` must *preserve* the individually-picked rows. Unioning onto the live
selection satisfies only the second; replacing the selection outright satisfies only the
first. Snapshotting at anchor-set time satisfies both, and matches Finder and Explorer.

### One `selectRange` reducer, three call sites

`setSelectionFromClick(id, renderedIds, { shift, meta })` is the only entry point
components call. It resolves plain / range / toggle internally.

*Why:* the modifier-to-behavior mapping is the part that is easy to get subtly wrong
(anchor movement on toggle but not on shift; shift-with-no-anchor). Encoding it once in
the store means every queue surface gets identical semantics and one unit test covers
all of them. Components stay dumb: they pass the event's modifier flags and their rows.

### `selectAll` is fixed, not worked around

The `itemType === "learning-item"` filter at `queueStore.ts:337` is removed so
select-all covers every rendered item, per spec. Callers that genuinely want
learning-items-only filter at their own call site.

*Why fix rather than add a second action:* every existing caller of `selectAll` feeds
the same bulk operations that now accept mixed types. Leaving the narrow behavior in
place and adding `selectAllVisible` alongside it would leave a latent trap — two
select-all functions differing in a way nothing in the name signals.

### A batched `applyItemDeltas` replaces N× `applyItemDelta`

New store action `applyItemDeltas(ids: string[], updates: Partial<QueueItem>)` does one
`items.map()` against a `Set` of ids and one `applyFilters()`.

*Why:* the per-item version is O(n) per call with a filter re-run each time, so a
200-item bulk action is 200 array copies and 200 filter passes. The batched version is
one of each. `applyItemDelta` stays for the single-item paths that already use it.

### Optimistic patching snapshots only the affected items

Before dispatch, capture the pre-change values of just the selected items; on rejection,
restore from that snapshot. Not a full `items` clone.

*Why:* a full-array snapshot per bulk action doubles peak memory on large queues for a
rollback that is the uncommon path. Restoring per-item is also correct under a partial
result — `BulkOperationResult.failed` names exactly which ids to roll back, so a batch
that half-succeeds reverts only the half that did not.

After a successful mutation the store sets `hasLocalDeltas: true`, so the existing
`reconcileIfDirty` focus-reload contract picks up server truth without a new mechanism.

### New Rust commands mirror the existing ones exactly

Five additions to `queue_bulk.rs`: `bulk_update_item_priorities`, `bulk_postpone_items`,
`bulk_set_item_lifecycle`, `bulk_move_items_to_collection`, `bulk_update_item_tags`.
Each takes `item_ids: Vec<String>`, resolves types through `resolve_queue_entities`,
runs inside one `sqlx` transaction, and returns `BulkOperationResult`.

*Why not extend the existing document-scoped commands:* `bulk_set_document_priority` and
`bulk_move_documents_to_collection` take document ids and are called from the documents
view, which has no type ambiguity. Queue ids do. Widening the document commands to
resolve types would make the documents view pay for a lookup it does not need, and would
change the meaning of commands other callers depend on.

*Transaction boundary:* one transaction for the whole batch, committed once. The current
`bulk_delete_items` loops per-id outside a transaction — the new commands do not copy
that, and the spec's "no partial write on failure" scenario is the reason.

### Bulk postpone reuses the single-item smart path

Smart Postpone calls the same priority-weighted interval computation the single-item
postpone already uses (the `postpone-engine` capability), once per item inside the batch
transaction. Fixed shifts add days directly and honor `interval_modifier`, matching
`queue_bulk.rs:229`.

*Why:* two implementations of the postpone formula would drift, and `postpone-engine`
already specifies the exact clamping behavior.

### Extract Mode gates at the shared selection handler

Rather than four viewer-specific edits, `isExtractMode` is threaded to the one place
each viewer's selection already converges before the popover is shown. Each viewer keeps
supplying its own position metadata (page for PDF, CFI/offset for EPUB, character offset
for Markdown/HTML) because that part legitimately differs per format.

*Why:* the bug is one missing branch, not four. Fixing it per viewer would mean four
places to keep in sync for every future change to extraction.

*Alternative rejected:* lifting `isExtractMode` into a store. It is per-viewer-instance
UI state that must reset on unmount; a store would make it leak across documents.

### Overdue sort computes from `dueDate` at sort time

`overdue` joins the `SortOptions` field union. The comparator derives
`max(0, floor((now - dueDate) / 86400000))` — the same expression as `reviewUx.ts:111` —
and treats a null `dueDate` as 0. Ties fall through to the existing default comparator.

*Why not persist an `overdue_days` column:* it is a pure function of `due_date` and the
current date, so a stored copy is stale the moment the day rolls over and would need a
daily recompute job to stay honest.

## Risks / Trade-offs

- **Removing the `learning-item` filter from `selectAll` changes existing behavior** →
  Audit every `selectAll` caller before the change and confirm each one wants all types.
  If one does not, it filters at its own call site rather than the store re-narrowing.

- **`Cmd/Ctrl + A` can hijack text selection** → The handler bails when the event target
  is an `input`, `textarea`, or `contenteditable`, and only binds while the queue list
  region holds focus. Spec has a scenario for this.

- **`Escape` competes with modal dismissal** → The queue-level handler is registered
  below overlays in the stacking order and skips when an overlay owns focus, so the
  topmost surface wins. Spec has a scenario for this.

- **Bulk Forget destroys scheduling history irreversibly** → Confirmation dialog before
  dispatch, and Forget is excluded from the undo toast because a memory-state reset
  cannot be reconstructed from the pre-image the way a soft delete can. Stated plainly
  in the confirmation copy.

- **Optimistic patching can desync from server truth on partial failure** → Roll back
  exactly the ids in `BulkOperationResult.failed`, and set `hasLocalDeltas` so the
  existing focus-reconcile reload corrects anything the patch got wrong.

- **200+ selected rows re-render on every selection change** → `selectedIds` is a `Set`,
  so row membership is O(1), and rows read only their own boolean. Accepted ceiling:
  the list is unvirtualized, so very large queues still pay a full-list reconcile per
  keystroke-driven selection change. Virtualization is the upgrade path if it bites.

- **PRD Bugs 9 and 10 may not reproduce** → They are scheduled as reproduce-then-fix, not
  as speculative rewrites. If they do not reproduce, the task records the finding and
  closes rather than churning `useDocumentSections` or `WebBrowserTab` on spec.

## Migration Plan

1. One migration adds `idx_learning_items_item_type` — additive, `IF NOT EXISTS`, no
   backfill, no data change.
2. New Rust commands are additive; no existing command signature changes.
3. `selectAll`'s behavior change is the only non-additive frontend edit; it ships with
   its callers audited in the same commit.
4. Rollback: revert the commit. The index can be left in place harmlessly — it is unused
   by prior code but costs only insert time.

## Open Questions

- Does Bulk Lifecycle "Done" map to an existing status field on all three item types, or
  only to documents and extracts? If learning items have no graduated state, the action
  should be disabled for selections containing them rather than silently no-op.
- Should the undo toast for Bulk Delete restore items to their original collection when
  that collection was deleted in between? Current single-item delete does not address
  this; matching its behavior is the default unless it proves wrong in testing.
