# Technical Design: Scheduling and Item Identity Integrity

## 1. Interval Modifier Persistence (`BUG-09`)
- `src-tauri/src/database/repository.rs::Repository::update_document` and `src-tauri/src/database/document_repository.rs::DocumentRepository::update_document` MUST bind `interval_modifier` in `UPDATE documents SET ...` and include `"schedule"` in `journal_document_fields`.
- `ItemDetailsPopover.tsx::handleSaveModifier` MUST use the returned `Document` from `updateDocument`, validate bounds (`0.1`–`10.0`), and sync `useDocumentStore`.
- `src/lib/browser-backend.ts::rate_document` MUST scale the computed interval by `doc.interval_modifier` (when finite and > 0) consistent with Rust `algorithm.rs`.

## 2. Parked Count Consistency (`BUG-14`)
- In `DocumentsView.tsx`, `CompactLibraryView`'s `filterCounts` MUST be computed over documents already filtered by `searchTokens`, `selectedFileType`, and `selectedCategory` (matching `filteredDocuments` before `compactFilter` is applied), so `Parked` count equals the exact number of rows shown when `Parked` is clicked.
- `onClearFilter` in the empty state MUST clear all active filters (`compactFilter`, `selectedCategory`, `selectedFileType`, `searchInput`) or clearly indicate which filter is hiding items.

## 3. Schedule View Exact Entity Identity (`BUG-15`)
- `useReviewStore.startReviewAtItem(itemId)` MUST check `queue.findIndex(item => item.id === itemId)`. If `-1`, it MUST call `getLearningItem(itemId)`:
  - If found, prepend/focus that exact `LearningItem` as `currentCard` (and ensure it's in `queue`) so the Review session opens that exact card.
  - If not found (deleted), set an explicit error/unavailable state rather than silently opening `queue[0]`.
- `ScheduleView.tsx` MUST carry typed entity references (`entityType: "document" | "extract" | "learning-item"`, `entityId`) through `ScheduleDayItem` and `handleOpen`, keying rows by `${entityType}:${id}`.

## 4. Suspension State & Discovery (`BUG-16`)
- `DocumentsView.tsx` context menu and bulk bar MUST inspect `isDismissed`:
  - Active documents show `Suspend`; suspended (`isDismissed === true`) documents show `Unsuspend` (calling `bulkUnsuspendItems`).
  - Mixed selections offer both `Suspend` and `Unsuspend` or clearly label actions.
- Document rows/cards MUST render a `Suspended` badge when `doc.isDismissed` is true.
- `CompactLibraryView` sidebar MUST include a `Suspended` filter (`doc.isDismissed === true`) so users can locate and unsuspend documents without deleting their history.
