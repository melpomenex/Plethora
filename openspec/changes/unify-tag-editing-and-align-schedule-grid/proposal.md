## Why

Tags are visible throughout Incrementum, but many of those surfaces still render them as passive labels, forcing users to leave their current context to categorize an item. The Schedule data grid also sizes its header and scrollable rows in separate containing blocks, so vertical overflow and expanded details can make metric labels appear offset from their values.

## What Changes

- Make persisted tags editable anywhere a document, extract, or learning item exposes its tag list: users can remove an existing tag and add a new tag without navigating to a separate editor.
- Use one shared tag-editing interaction across full detail panels and compact list/card surfaces, with compact surfaces allowed to open a small editor rather than placing destructive controls on every chip.
- Extend the existing Queue item tag mutation behavior into a reusable cross-surface component and mutation path, including duplicate/empty guards, optimistic feedback, rollback on failure, keyboard operation, and accessible labels.
- Keep all mounted views of an item synchronized after a tag mutation so a successful edit is reflected in Queue, Schedule, Documents, review/card-management, and graph/detail surfaces without a full application reload.
- Preserve explicitly non-editable contexts: import/source metadata that has not become an Incrementum item, destructive confirmation summaries, exported/printed output, and RSS tags managed by the separate RSS relational tag system.
- Align the Schedule data-grid header, body rows, and expanded metric details to one shared column definition and the same scroll viewport/gutter, including when a vertical scrollbar is present.
- Add regression coverage for tag persistence and Schedule column alignment at representative desktop widths and overflow states.

## Capabilities

### New Capabilities
- `cross-surface-item-tag-editing`: Consistent add/remove controls, persistence, synchronization, error recovery, and accessibility for persisted document, extract, and learning-item tags wherever those tags are presented for item management.

### Modified Capabilities
- `schedule-workspace`: Require Schedule data-grid headers, row values, and expanded metrics to remain geometrically aligned under scrolling, overflow, and supported desktop widths.

## Impact

- Shared frontend tag UI and mutation orchestration under `src/components/common/` and/or `src/hooks/`, building on `ItemDetailsPopover` and the existing document/extract/learning-item update APIs.
- Tag-bearing surfaces in Documents, Queue/Review Queue, Schedule Agenda/Data Grid, extract and learning-card lists/previews, and graph/detail panels will adopt the shared editor or an editor trigger.
- Queue/document/extract/learning-item stores or a small tag-update notification mechanism will reconcile successful mutations across mounted consumers.
- `src/components/schedule/ScheduleDataGrid.tsx` and `ScheduleItemDetails.tsx` will share column tracks and scroll geometry; Schedule component tests gain alignment assertions.
- No database schema, tag representation, scheduling algorithm, or new third-party dependency is required.
