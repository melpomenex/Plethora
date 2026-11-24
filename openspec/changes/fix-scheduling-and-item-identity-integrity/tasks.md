## 1. Interval Modifier Persistence (BUG-09)
- [ ] 1.1 Add `interval_modifier` to `Repository::update_document` (`src-tauri/src/database/repository.rs`) and `DocumentRepository::update_document` (`document_repository.rs`), and `"schedule"` to `journal_document_fields`.
- [ ] 1.2 Sync `useDocumentStore` and returned `Document` in `ItemDetailsPopover.tsx::handleSaveModifier`.
- [ ] 1.3 Apply `interval_modifier` in `src/lib/browser-backend.ts::rate_document`.

## 2. Parked Count Consistency (BUG-14)
- [ ] 2.1 Compute `CompactLibraryView` `filterCounts` from category/type/search-filtered documents in `DocumentsView.tsx`.
- [ ] 2.2 Ensure empty-state reset clears conflicting filters when requested.

## 3. Schedule View Identity (BUG-15)
- [ ] 3.1 Update `useReviewStore.ts::startReviewAtItem` to fetch `getLearningItem(itemId)` when not in due `queue`, or surface an unavailable error instead of opening `queue[0]`.
- [ ] 3.2 Propagate typed entity references (`entityType`, `entityId`) in `ScheduleView.tsx` and `QueueTab.tsx` with collision-free keys.

## 4. Suspension State & Discovery (BUG-16)
- [ ] 4.1 Toggle `Suspend` / `Unsuspend` in `DocumentsView.tsx` context menu and bulk action bar based on `isDismissed`.
- [ ] 4.2 Add `Suspended` badge on dismissed documents and a `Suspended` filter in `CompactLibraryView`.

## 5. Regression Tests
- [ ] 5.1 Add Rust test verifying `update_document` persists `interval_modifier` across reload and `rate_document` uses it.
- [ ] 5.2 Add Vitest tests for `DocumentsView` Parked count & Suspend/Unsuspend toggle, and `reviewStore.startReviewAtItem` with future-scheduled and missing cards.
