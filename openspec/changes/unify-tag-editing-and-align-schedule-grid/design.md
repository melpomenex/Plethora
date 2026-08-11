## Context

Documents, extracts, and learning items store freeform tags as JSON string arrays and already have update APIs. `ItemDetailsPopover` recently added optimistic per-item tag editing for Queue, but its mutation and interaction logic is local to that component. Many other persisted-item surfaces still render passive pills, including Schedule details, Documents layouts/inspectors, learning-card previews and lists, and graph detail panels. Create/edit/import forms already support tag changes and do not need another editor.

Schedule Data grid uses the same `GRID_COLUMNS` string for its header and rows, but the header is outside the vertically scrollable body. When the body reserves space for a scrollbar, the two grids have different inline widths and their flexible title track resolves differently, shifting every metric column. Expanded `ScheduleItemDetails` also uses an unrelated two/three-column metric grid, so its values cannot align to the data-grid headers.

## Goals / Non-Goals

**Goals:**
- Make add/remove tagging available at every persisted document/extract/learning-item management surface while preserving each surface's density.
- Centralize validation, mutation, optimistic state, error recovery, accessibility, and cross-view reconciliation.
- Keep Schedule header, row, and applicable expanded-detail metrics on the same geometric column tracks through overflow and resize.
- Preserve virtualization and avoid per-row data fetching or new backend round trips.

**Non-Goals:**
- Replacing freeform tag arrays with tag entities, IDs, or a database migration.
- Renaming, merging, bulk-editing, or globally deleting tags.
- Changing RSS's relational tag system or making source/import metadata mutate persisted library items prematurely.
- Making confirmation, export, or printed representations interactive.
- Changing scheduling calculations or the Agenda layout into a table.

## Decisions

### 1. Define eligibility by persisted-item semantics, not every `tags` field

The implementation will inventory user-facing tag presentations for persisted documents, extracts, and learning items. Full detail/inspector surfaces will render the editor inline. Compact cards, rows, and graph selections may use an edit button or interactive tag group that opens a small popover containing the same editor. Existing create/edit forms already satisfy the requirement and may retain their form-specific layout.

Explicit exceptions are RSS relational tags, pre-persistence import/source metadata, confirmation summaries, output-only views, and derived tags used only for internal type detection. This prevents a literal code-search replacement from adding dangerous controls to delete confirmations or trying to persist third-party metadata through the wrong API.

Alternative considered: place an `×` on every chip everywhere. Rejected because dense rows would become noisy and easy to mutate accidentally.

### 2. Extract one controlled editor and one item-type mutation adapter

Create a shared `ItemTagEditor` (name may vary) that receives an `ItemTagTarget` (`document | extract | learning-item`, stable id), the current tag list, presentation mode (`inline | compact`), and an optional reconciliation callback. Move trimming, case-insensitive duplicate detection, busy state, optimistic update, rollback, keyboard handling, localized labels, and error toasts out of `ItemDetailsPopover` into a reusable hook/service.

The mutation adapter dispatches to the existing document, extract, and learning-item tag update APIs. It sends the complete next tag array, matching current persistence semantics, and serializes mutations per item so a second operation cannot be computed from stale state. No new Tauri command is required.

Alternative considered: let every surface call its store/API directly. Rejected because the current inconsistency came from duplicating tag rendering and mutation patterns.

### 3. Reconcile successful mutations through the owning store plus a narrow update notification

The initiating surface updates optimistically. On success, the adapter publishes a typed item-tags-updated notification containing item type, id, and the persisted tag list. Mounted Queue/Schedule collections and document/extract/learning-item stores update the matching entity or perform their existing bounded refresh. Components holding a local item snapshot subscribe through their owning store or receive the parent's reconciliation callback; they do not each add global listeners.

This keeps already-mounted surfaces consistent without a page reload while avoiding a new global normalized entity store. Notifications are emitted only after persistence succeeds; rollback stays local to the initiating editor.

Alternative considered: refetch every tag-bearing dataset after every edit. Rejected because it adds unnecessary Tauri/database work and can disturb virtualized list position.

### 4. Keep tag removal explicit and editing accessible

Inline mode renders removable chips plus an add input/control. Compact mode renders the readable chips/count with a localized edit affordance that opens a focus-managed popover; opening or browsing a chip never removes it. Enter confirms input, Escape closes a compact editor, focus returns to its trigger, and busy/error state is programmatically exposed. Chips wrap within detail layouts and remain contained inside narrow popovers.

### 5. Give Schedule one grid coordinate system

Move the sticky data-grid header into the same horizontal/vertical scroll viewport as the virtualized rows, or introduce an equivalent shared inner grid whose inline width includes a stable scrollbar gutter. Extract the track definition and semantic column keys into a shared module/constant used by header, row, and grid-mode detail rendering. Preserve a minimum grid width and contained horizontal scrolling rather than shrinking numeric columns below readability.

`ScheduleItemDetails` gains a layout mode. Agenda keeps its labeled responsive detail grid. Data-grid mode places duplicate metrics into their semantic columns using the shared tracks; category/tags and the primary action occupy a deliberate full-width/detail region without changing the parent row's column widths. Virtualizer measurement continues to include the expanded detail height.

Alternative considered: compensate the detached header with a hardcoded scrollbar-width padding. Rejected because scrollbar width/overlay behavior varies across macOS, Windows, Linux, and webviews.

### 6. Test contracts rather than pixel snapshots alone

Component tests will cover shared tag validation, type dispatch, optimistic success, rollback, serialization, and update notification. Representative host-surface tests will verify both inline and compact integration, with an inventory checklist guarding the audited surfaces. Schedule tests will assert corresponding header/row/detail cells share column keys and bounding positions within a small tolerance with vertical overflow, horizontal overflow, expansion, and resize. Visual manual verification will cover platform scrollbar differences.

## Risks / Trade-offs

- **[Risk] Broad adoption touches many large components and may cause unrelated render regressions** → Migrate by surface group, keep the shared editor controlled, and add representative integration tests before replacing remaining passive presentations.
- **[Risk] A stale local snapshot can overwrite a newer tag list** → Serialize mutations per item, reconcile from the persisted response, and update mounted stores from the success notification.
- **[Risk] Editing controls make dense rows visually noisy** → Use compact trigger/popover mode and never require a visible remove button on every collapsed-row chip.
- **[Risk] Cross-platform scrollbar behavior can still expose small offsets** → Put header and rows in one scroll coordinate system and manually verify overlay and classic scrollbars rather than relying on fixed compensation.
- **[Trade-off] Allowed informational contexts remain read-only** → Document each exception in the inventory so it is intentional and testable rather than an accidental omission.

## Migration Plan

1. Add and test the shared tag editor/mutation adapter while keeping `ItemDetailsPopover` behavior unchanged.
2. Replace the Queue-local implementation, then adopt the shared editor in Schedule and the other audited surface groups.
3. Add cross-view reconciliation and verify edits persist and appear in concurrently mounted consumers.
4. Refactor Schedule grid geometry and detail layout, then run alignment tests and manual scrollbar checks.
5. Rollback is source-only: restore individual host surfaces to their passive presentation and detached Schedule header if needed; no persisted data or schema migration requires reversal.

## Open Questions

- None required before implementation. The surface inventory may identify additional informational-only renderers; each must be classified against the eligibility rule rather than silently skipped.
