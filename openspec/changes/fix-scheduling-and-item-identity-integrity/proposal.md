# Change: Fix Scheduling Interval Modifiers, Item Identity, Parked Counts, and Suspension State

Covers **BUG-09** (interval modifier fails and resets to 1.0), **BUG-14** (Parked count disagrees with displayed contents), **BUG-15** (Schedule View opens the wrong card), and **BUG-16** (suspension state unclear / still shows Suspend).

## Why

1. **BUG-09 (Interval modifier resets to 1.0):** `Repository::update_document` and `DocumentRepository::update_document` omit `interval_modifier` from their SQL `UPDATE documents` statements and `journal_document_fields` omits `"schedule"`. Browser `rate_document` also ignores `interval_modifier`.
2. **BUG-14 (Parked count = 9, 0 documents shown):** `CompactLibraryView` computes `filterCounts` over unfiltered `documents` while `filteredDocuments` applies `selectedCategory`, `selectedFileType`, and search tokens.
3. **BUG-15 (Schedule View opens wrong card):** `useReviewStore.startReviewAtItem(itemId)` calls `loadQueue()` (which only loads currently due items and sets `currentCard = queue[0]`), then bails out if `itemId` is not in `queue` (any future-scheduled item), leaving `currentCard` on `queue[0]`. Extract items in Schedule View also drop `extractId`.
4. **BUG-16 (Suspension state unclear):** `DocumentsView` hardcodes "Suspend" in bulk actions and context menus without checking `doc.isDismissed`, renders no suspended badge, and has no suspended filter.

## What Changes

- **Persist & apply `interval_modifier`:** Include `interval_modifier` in `Repository::update_document`, `DocumentRepository::update_document`, and `journal_document_fields`; update `useDocumentStore` from `ItemDetailsPopover`; apply `interval_modifier` consistently in browser `rate_document` as well as Rust `rate_document`/`rate_document_engaging`.
- **Canonical Parked count & empty-state clarity:** Compute `filterCounts` from the same category/type/search-filtered document predicate (or explicitly distinguish total vs matching count in the UI) so Parked count and displayed list always agree.
- **Unambiguous Schedule View entity navigation:** Fetch/inject the exact target learning item in `startReviewAtItem(itemId)` when not already in the due queue (showing an unavailable state if deleted instead of opening a substitute), and preserve typed entity references (`document` / `extract` / `learning-item`) in `ScheduleView`.
- **Authoritative Suspend / Unsuspend UI:** Toggle Suspend vs Unsuspend based on `isDismissed` in `DocumentsView` context menus and bulk bar, render a clear `Suspended` indicator on suspended documents, and add a `Suspended` filter in the Library sidebar.
