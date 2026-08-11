## 1. Tag Surface Inventory and Shared Contracts

- [x] 1.1 Audit every user-facing tag renderer for documents, extracts, and learning items; record each as inline-editable, compact-editor, already-editable form, derived/internal, RSS-specific, or allowed informational exception
- [x] 1.2 Define the shared `ItemTagTarget`, editor presentation modes, mutation result, and typed item-tags-updated notification contracts
- [x] 1.3 Add a case-insensitive tag normalization/duplicate guard that trims new input while preserving the display casing of accepted tags

## 2. Shared Tag Mutation and Editor

- [x] 2.1 Implement one item-type mutation adapter that persists complete tag arrays through the existing document, extract, and learning-item update APIs
- [x] 2.2 Implement controlled optimistic tag state with per-item mutation serialization, success reconciliation, failure rollback, and localized error feedback
- [x] 2.3 Publish successful typed tag-update notifications and connect the owning document, extract, learning-item, Queue, and Schedule stores/collections so mounted copies converge without a full reload
- [x] 2.4 Build the shared inline editor with removable chips, add input/button, explicit busy state, Enter submission, visible focus, and localized accessible names
- [x] 2.5 Build the compact focus-managed editor trigger/popover with Escape dismissal, focus return, contained responsive layout, and no remove-on-chip-body behavior
- [x] 2.6 Add shared-editor unit tests for valid add, empty/duplicate rejection, explicit removal, type dispatch, pending-operation blocking, persisted reconciliation, rollback, notification, and keyboard focus behavior

## 3. Queue, Schedule, and Documents Adoption

- [x] 3.1 Refactor `ItemDetailsPopover` to use the shared editor while preserving Queue tag browsing, RSS read-only behavior, and existing action controls
- [x] 3.2 Add inline tag editing to shared `ScheduleItemDetails` so both Agenda and Data grid expanded rows can add and remove tags and reconcile the visible schedule item
- [x] 3.3 Replace passive persisted-tag presentations in the current Documents library layouts and active-document inspector with inline or compact shared editing as appropriate
- [x] 3.4 Update any still-routable legacy Documents/Queue tag presentations to use the shared editor, or document and test why the route is no longer a management surface
- [x] 3.5 Add representative integration tests proving document, extract, and learning-item edits initiated from Queue, Schedule, and Documents persist and update their host view

## 4. Extract, Learning, Review, and Graph Adoption

- [x] 4.1 Adopt the shared editor in persisted extract list/inbox/detail presentations while retaining existing create/edit dialog form behavior
- [x] 4.2 Adopt the shared editor or compact trigger in learning-card lists, card preview, Deck Manager rows, and applicable review-item tag presentations
- [x] 4.3 Adopt the shared editor or compact trigger in document/learning-item graph detail panels and the Semantic Graph selected-item detail, using stable persisted item identities
- [x] 4.4 Classify assistant results, import previews, media/source tags, delete confirmations, print/export output, and derived tag checks; keep allowed exceptions non-mutating and RSS tags on their relational APIs
- [x] 4.5 Re-run the checked-in tag-surface inventory and add a regression test/check that fails when an audited persisted-item presentation remains passive or an exception is undocumented

## 5. Schedule Data-Grid Alignment

- [x] 5.1 Extract the Schedule data-grid track definition and semantic column keys into a shared definition used by the header, rows, and data-grid detail layout
- [x] 5.2 Put the sticky header and virtualized rows in the same horizontal sizing/scroll coordinate system with a stable scrollbar gutter and a readable minimum grid width
- [x] 5.3 Add a data-grid layout mode to `ScheduleItemDetails` that places duplicate metrics on their semantic columns while keeping tags/category/actions in a deliberate spanning region; retain the responsive Agenda detail layout
- [x] 5.4 Verify expanding/collapsing a virtualized row remeasures its detail height without overlap, scroll jumps, or loss of sticky date/header context
- [x] 5.5 Add Schedule component/browser tests for header-to-row and header-to-detail alignment with vertical overflow, horizontal overflow, expansion, and live pane resize at representative supported widths

## 6. Accessibility, Regression, and Performance Verification

- [x] 6.1 Add all new user-visible tag editor strings, error messages, tooltips, and accessible labels to the locale source and verify fallback behavior
- [x] 6.2 Test inline and compact editors with keyboard-only navigation, narrow panes, touch-sized controls, long tags, many tags, empty tags, and rapid repeated input
- [ ] 6.3 (manual desktop verification — pending human run) Manually verify tag persistence and cross-surface synchronization for one document, extract, and learning item in the desktop app, including rollback/error behavior where practical
- [ ] 6.4 (manual desktop verification — pending human run) Manually verify Schedule metric alignment with classic and overlay scrollbar behavior at multiple desktop widths and confirm Agenda/mobile layouts remain unchanged
- [x] 6.5 Run targeted Vitest suites, `npm run build:check`, and `npm run bench:check`; resolve functional, bundle-budget, or normalized performance regressions before completion
