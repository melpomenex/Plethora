## Why

Queue curation is one-item-at-a-time. The store already tracks `selectedIds` and the
backend already exposes batch commands, but nothing in the UI lets a user *build* a
selection: there is no `Shift + Click` range, no `Cmd/Ctrl + Click` toggle, no
`Cmd/Ctrl + A`, no `Escape`. `BulkActionBar` renders three verbs (suspend, unsuspend,
delete) out of the eight the workflow needs. Curating a 200-item queue is therefore
still 200 interactions.

Separately, the Extract Mode toggle in the reader is decorative: `isExtractMode`
(`DocumentViewer.tsx:418`) is read only to style its own button (`:5988`, `:5992`,
`:5996`) and set a crosshair cursor (`:6313`). No selection handler consumes it, so
turning it on changes the pointer and nothing else.

**Scope note — the source PRD is substantially stale.** Ten of its items are already
implemented on `main` and are *excluded* from this change. Verified, with evidence:

| PRD item | Already shipped |
|---|---|
| Bug 1.1 idle-deferred startup | `main.tsx:238`, `documentStore.ts:54`, `fileSyncRegistration.ts:178` |
| Bug 1.2 indexes (`collection_id`, `state`, `due`, `item_type`) | `001_initial.sql:114-117`, `007_add_collections.sql:30-38`, and migration `074_add_composite_indexes` which already adds `idx_learning_items_type` and `idx_documents_due` — **all four covered**, no migration needed |
| Bug 3 doc-before-segmentation | `documentStore.ts:679` imports, `:699` segments only when `autoProcessOnImport` |
| Bug 4 default-collection guard | `007_add_collections.sql:15-16` is already `INSERT OR IGNORE` on a fixed UUID — idempotent by construction; the PRD's proposed fix is a no-op |
| Bug 5 occlusion coordinates | `FlashcardStudioModal.tsx:1699-1714` already letterbox-corrects via `imgBounds`, in CSS pixels (DPR-independent) |
| Bug 6 `itemTypes` enforcement | `ReviewQueueView.tsx:418-424`, `:451` hard post-filter. `computeOptimalQueue` does not exist anywhere in the repo |
| Bug 7 `focusedExtractId` | Threaded `QueueTab.tsx:41` → `DocumentViewerWrapper.tsx:351` → `DocumentViewer.tsx:2287` → `ExtractsList.tsx:186` |
| Bug 8 `showFeaturePopups` | `settingsStore.ts:244`, toggle at `SettingsPage.tsx:906`, honored by `TourHost.tsx:96` and `FSRSExplanationModal.tsx:388` |
| Feature 1 interval modifier | Migration `075`, applied at `algorithm.rs:253`/`:358` and `queue_bulk.rs:229`, editable in `ItemDetailsPopover` |
| Feature 2 `first_reviewed_at` | Migrations `076`/`077`, written at `algorithm.rs:279`/`:391`, `review.rs:518`, `repository.rs:2603`, shown at `ItemDetailsPopover.tsx:662` |
| Feature 3 overdue badge | `reviewUx.ts:111` computes it; `ReviewQueueView.tsx:1590-1616` renders "Outstanding since … (Nd overdue)" — only the **sort option** is missing |

## What Changes

- **Selection mechanics** on the queue list: `Shift + Click` range from an anchor
  index, `Cmd/Ctrl + Click` toggle, `Cmd/Ctrl + A` select-all-visible (filter- and
  search-respecting), `Escape` clear, header checkbox with indeterminate state, and
  per-row checkbox + `bg-primary/10 border-primary` highlight.
- **Bulk action bar** grows from 3 actions to 8: priority, postpone (fixed shift and
  smart), suspend/unsuspend, move to collection, tags, lifecycle (done / dismiss /
  forget), AI Flashcard Studio hand-off, and delete-with-undo. Relocated to a floating
  bottom-center glass bar.
- **New batch IPC** for the gaps the backend does not cover: `bulk_update_item_priorities`,
  `bulk_postpone_items`, `bulk_set_item_lifecycle`, `bulk_move_items_to_collection`, and
  `bulk_update_item_tags` — each one SQLite transaction. Existing `bulk_suspend_items`,
  `bulk_unsuspend_items`, `bulk_delete_items`, `bulk_set_document_priority`,
  `bulk_move_documents_to_collection` are reused, not duplicated.
- **Optimistic patching** for every bulk action via the store's existing
  `applyItemDelta` / `removeItemsLocally` / `hasLocalDeltas` reconcile path, with
  rollback on IPC rejection.
- **Extract Mode toggle becomes functional** — the flag gates auto-extract on text
  selection across the PDF, EPUB, Markdown, and HTML reader paths.
- **`Overdue Days (Descending)` sort option** added to the queue sort field union.
- **Performance touch-ups**: the six
  remaining whole-store subscriptions (`MobileLayoutWrapper.tsx:24`,
  `useQueueNavigation.ts:33`, `ReviewSession.tsx:97`, `AlgorithmArenaDecision.tsx:70`,
  `DeckManager.tsx:62`, `ZenReviewMode.tsx:311`) narrowed to property selectors.
- **Triage-first** for PRD Bugs 9 (`#` section mention) and 10 (in-app browser): both
  are reported symptoms neither confirmed nor refuted by static reading —
  `useDocumentSections` parses and `WebBrowserTab` has error paths. These get a
  reproduce-then-fix task rather than a speculative rewrite.

**BREAKING**: none. `selectedIds`, the existing bulk commands, and stored occlusion
region coordinates (percent, `0–100`) keep their current shapes. The PRD's request to
switch occlusion output to normalized `[0.0, 1.0]` is **declined** — it would invalidate
every stored region for no behavioral gain.

## Capabilities

### New Capabilities
- `queue-multi-select`: selection model for the queue list — anchor index, range
  extension, additive toggle, select-all-visible, clear, and the visual/checkbox state
  that reflects it.
- `queue-bulk-actions`: the contextual action bar, the eight bulk operations it exposes,
  their batched transactional IPC contracts, optimistic patching, and undo.
- `extract-mode-toggle`: Extract Mode gating auto-extraction of reader text selections
  across all four viewer types.
- `queue-overdue-sort`: `Overdue Days (Descending)` as a selectable queue sort order.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ defines requirements for queue selection,
     the bulk action bar, reader extract mode, or queue sort fields. The perf touch-ups
     (index, store selectors) are implementation details with no spec-level behavior
     change and are covered in tasks.md only. -->

## Impact

- **Frontend**: `src/stores/queueStore.ts` (selection actions, optimistic bulk paths),
  `src/components/queue/BulkActionBar.tsx` (rewrite), `src/routes/queue.tsx` and
  `src/components/review/ReviewQueueView.tsx` (row click handling, keyboard),
  `src/components/viewer/DocumentViewer.tsx` (extract mode wiring), `src/types/queue.ts`
  (sort field union).
- **Backend**: `src-tauri/src/commands/queue_bulk.rs` (five new commands),
  `src-tauri/src/lib.rs` (handler registration), one new migration for the `item_type`
  index.
- **Dependencies**: none added. Reuses `@phosphor-icons/react`, the existing
  `BulkOperationResult` shape, `useI18n`, and the toast/undo system.
- **Risk**: the delete-with-undo path touches destructive operations — it must reuse the
  existing `bulk_delete_items` semantics and keep the confirmation dialog.
