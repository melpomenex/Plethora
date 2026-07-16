## Context

`ItemDetailsPopover` (`src/components/common/ItemDetailsPopover.tsx`) is a shared popover used from the Queue (`QueueScrollPage.tsx`) to show scheduling stats and a read-only tag list for `document` / `extract` / `learning-item` / `rss` targets. Tags for the first three types are plain JSON string arrays stored directly on their rows (`documents.tags`, `extracts.tags`, `learning_items.tags` — `src-tauri/migrations/001_initial.sql`), edited today only through `EditExtractDialog.tsx` and `DocumentsView.tsx`, both of which use a "buffer locally, save whole item on submit" pattern. RSS tagging is a separate relational system (`src/api/rss-tags.ts`, `TagManagementView.tsx`) and is out of scope here — RSS targets keep read-only tags.

There is no existing command or UI for "find every item carrying tag X" across documents/extracts/learning-items — `get_articles_by_tag` in `rss_features.rs` is RSS-only and not reusable (different table, different tag model).

The popover is opened mid-review, often repeatedly across many queue items in one sitting, so edits must be fast (no extra confirm step) and must not force the reviewer to lose their place if a save fails.

## Goals / Non-Goals

**Goals:**
- Let a user add/remove tags on the item currently shown in the Queue Details popover, for document/extract/learning-item types, without leaving the Queue.
- Let a user click a tag pill (view mode) to see every item across documents/extracts/learning-items carrying that tag, in a modal, with a way to open any listed item.
- Surface postpone / dismiss / delete as one-click actions inside the same popover, reusing existing store actions rather than duplicating logic.
- Keep the popover fast to open/use during back-to-back review — no jarring modal-within-popover unless the user asks for the tag-browse view.

**Non-Goals:**
- No change to RSS tag editing/management (`TagManagementView.tsx` stays the source of truth for RSS tags).
- No new tag data model (no tag IDs, no tag table for documents/extracts/learning-items) — stays freeform JSON string arrays, matching current app-wide convention for these three types.
- No bulk tag operations (rename-across-items, merge, multi-select tagging) — that's a larger feature and not implied by "the specific item" framing in the request.
- No tag autocomplete backed by a global tag index service; suggestions are drawn from tags already used on other visible/recent items via a lightweight query, not a new search index.

## Decisions

**1. Per-tag optimistic mutation, not buffer-and-save.**
Unlike `EditExtractDialog`'s "edit everything, save once" form, the popover will call `update_document`/`update_extract`/`update_learning_item` immediately on each add/remove, optimistically updating the pill list, with toast-based rollback on failure (matching `DocumentsView.tsx`'s existing add/remove-tag pattern). Rationale: the popover is a quick-glance tool during review, not a form the user "submits" — matching its existing dismiss/undismiss button, which is also immediate.

**2. New Tauri command `get_items_by_tag(tag)` rather than three client-side list calls.**
Add one Rust command that queries `documents`, `extracts`, and `learning_items` tables for rows whose `tags` JSON array contains the given tag (via SQLite `json_each`), returning a small summary struct per hit (id, type, title, category) sorted by type then title. Alternative considered: reuse existing `list_documents`/`list_extracts`/`list_learning_items` endpoints and filter client-side — rejected because those endpoints aren't guaranteed to return the full untruncated set (pagination/limits exist elsewhere in the app) and would require fetching everything to filter reliably.

**3. Tag-browse modal built on the existing `Modal.tsx` singleton, not a new popover/portal.**
Reuse `showModal()` / `ModalType` from `src/components/common/Modal.tsx` for the "items with this tag" view (size `md`), consistent with every other modal in the app, rather than inventing a second overlay system. Clicking a result closes the modal and navigates to/opens that item (behavior depends on type — document/extract open their existing viewer route; learning-item opens its parent document at the relevant position, matching how other "jump to item" affordances in Queue behave).

**4. Common-actions row reuses `useQueueStore` actions directly; no new store methods.**
Postpone uses `postponeItemSmart` (same as `QueueContextMenu.tsx`), dismiss/undismiss reuses the existing `handleDismissToggle` logic already in the popover, delete reuses the same confirm-then-delete flow as `QueueContextMenu.tsx` (including its `confirm()` dialog). This avoids two divergent implementations of the same action.

## Risks / Trade-offs

- **[Risk]** Optimistic tag edits could visually flicker or desync if the same item is edited from two places at once (e.g. popover open while `DocumentsView` also open) → **Mitigation**: on save success, popover uses the server response to reconcile state rather than trusting its own optimistic copy blindly; this is a pre-existing class of risk in the app already (no cross-tab sync exists anywhere), not newly introduced.
- **[Risk]** `json_each`-based tag query across three tables could be slow on very large libraries with no tag index → **Mitigation**: tags columns are small JSON arrays per row already scanned elsewhere (e.g. category filters); acceptable for expected library sizes. Add a note in tasks to verify query plan if it becomes a bottleneck; no index added preemptively (YAGNI).
- **[Trade-off]** Tag-browse modal only covers documents/extracts/learning-items, not RSS articles, even though RSS also has tags — consistent with the proposal's scoping, but could read as an inconsistency to users who tag RSS articles. Documented as a known gap, not silently hidden.

## Open Questions

- For a `learning-item` result in the tag-browse modal, should clicking it open the parent document and scroll to the item, or push it to the front of the Queue? Default to "open parent document," matching existing navigation elsewhere — confirm during implementation if a queue-jump makes more sense.
