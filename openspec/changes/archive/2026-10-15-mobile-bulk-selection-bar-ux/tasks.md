## 1. Shared Responsive Bulk Action Bar Component

- [x] 1.1 Create `src/components/common/ResponsiveBulkActionBar.tsx` with mobile shell awareness (`useMobileShell`), compact count badge with 1-tap clear button (✕), single-row horizontal touch scroll track (`overflow-x-auto no-scrollbar touch-pan-x flex-nowrap`), and optional overflow action sheet trigger. Verify unit tests in `src/components/common/__tests__/ResponsiveBulkActionBar.test.tsx` pass.
- [x] 1.2 Add CSS rules in `src/styles/mobile.css` for floating selection toolbars (`.responsive-bulk-action-bar` and `.bulk-action-bar-container`) ensuring they anchor at `bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))` on phone presentation. Verify styling applies when `:root[data-presentation="phone"]` is active.

## 2. DocumentsView Integration

- [x] 2.1 Refactor `src/components/documents/DocumentsView.tsx` selection toolbar to use `ResponsiveBulkActionBar`, rendering as a floating bottom bar above mobile nav on mobile viewports, and preserving desktop header layout on desktop viewports. Verify no buttons are horizontally clipped on narrow (360px) screens.
- [x] 2.2 Wire all document actions (Select All / Clear Selection, Tag, Move, Reprioritize, Suspend, Archive, Delete) into the responsive bar with icons, localized labels, and an overflow bottom sheet (`MobileContextMenuSheet`) on phone screens. Verify existing tests in `src/components/documents/__tests__/DocumentsView.test.tsx` pass.
- [x] 2.3 Ensure bottom scroll padding in `DocumentsView` document list (`documentsScrollRef`) accounts for the floating bottom bar when selection is active so the bottom-most document card remains fully visible. Verify scrolling reaches the bottom card.

## 3. Queue BulkActionBar & Review Surfaces Integration

- [x] 3.1 Update `src/components/queue/BulkActionBar.tsx` to respect mobile bottom navigation clearance (`.bulk-action-bar-container`) and prevent multi-line card wrapping sprawl on phones with a single-row scroll track or prioritized actions. Verify `src/components/queue/__tests__/BulkActionBar.test.tsx` passes.
- [x] 3.2 Update `src/components/review/ReviewQueueView.tsx` to adopt the responsive selection bar for bulk actions (Suspend, Unsuspend, Delete), floating on mobile viewports. Verify review queue selection tests pass.
- [x] 3.3 Update `src/components/extracts/ExtractsList.tsx` bulk actions to adopt responsive toolbar styling and horizontal scroll container so "Generate Cards", "Delete", and "Clear" never wrap awkwardly or clip. Verify extracts list tests pass.
- [x] 3.4 Update `src/components/review/DeckManager.tsx` bulk actions to support responsive touch targets and prevent clipping on phone screens. Verify deck manager tests pass.

## 4. Verification and Regression Testing

- [x] 4.1 Run unit test suites (`npm test`) covering all modified components and verify all tests pass.
- [x] 4.2 Run performance benchmark check (`npm run bench:check`) to ensure bundle budgets and performance baselines remain green.
- [x] 4.3 Verify mobile viewport layout (360px × 800px) across all updated surfaces (Documents, Queue, Extracts, Review) confirming no horizontal clipping and full clearance above the bottom navigation bar.
