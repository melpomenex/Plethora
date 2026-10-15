## 1. Database Migrations & Schema

- [x] 1.1 Create SQLite migration adding composite indexes: `idx_documents_collection_state`, `idx_documents_due`, `idx_learning_items_document_state`, `idx_learning_items_due`, `idx_learning_items_type`, `idx_review_log_item`
- [x] 1.2 Create SQLite migration adding `interval_modifier REAL DEFAULT 1.0` column to `documents` table
- [x] 1.3 Create SQLite migration adding `first_reviewed_at DATETIME` column to `documents` and `learning_items` tables, with backfill from `MIN(review_date)` in `review_log`

## 2. Startup Performance

- [x] 2.1 Audit `src/App.tsx` and top-level `useEffect` hooks: wrap non-critical initialization (sync, RSS, analytics, AI) in `requestIdleCallback` with 3s timeout fallback
- [x] 2.2 Audit all bare `useXxxStore()` calls in `queueStore`, `documentStore`, and `reviewStore` consumers and replace with selector subscriptions or `useShallow`

## 3. Queue Filter Enforcement

- [x] 3.1 Add hard post-filter step in `queueStore.fetchQueue` / `computeOptimalQueue`: enforce `itemTypes` exclusions (flashcard_ratio=0 removes all flashcards, extracts-only removes documents/flashcards)
- [x] 3.2 Verify queue session settings UI correctly passes item-type and percentage params to the queue computation

## 4. Extract Queue Navigation

- [x] 4.1 Extend queue item payload to include `extractId` and `sourceContext` (character offset / page number)
- [x] 4.2 Update queue navigation actions to pass extract context through to `DocumentViewer`
- [x] 4.3 Implement `focusedExtractId` consumption in `DocumentViewer`: auto-scroll to extract position on mount (PDF page scroll, text offset scroll) with highlight

## 5. Collection Seeding Guard

- [x] 5.1 Audit `collectionStore` and migration/seeding scripts for auto-collection creation paths
- [x] 5.2 Guard default collection seeding to run only when `collections` table is empty; remove auto-collection creation fallbacks on import/tag assignment

## 6. Extract Mode Toggle

- [x] 6.1 Wire extract mode toggle button state to the document viewer state machine (`useDocumentViewer` / `DocumentViewer.tsx`)
- [x] 6.2 Add visual indicators (cursor crosshair, active mode badge) for extract mode across PDF, EPUB, Markdown, and HTML viewers

## 7. Web Article Import Fix

- [x] 7.1 Fix import handler (`processHtmlContent` / `webArticleImport`) to create a top-level Document node before processing content
- [x] 7.2 Make paragraph/semantic segmentation opt-in only; default import preserves article as single document

## 8. Image Occlusion Coordinates

- [x] 8.1 Fix manual occlusion canvas coordinate mapping in `FlashcardStudio`: account for CSS scaling, DPR, and scroll offsets
- [x] 8.2 Standardize AI vision model bounding box output to normalized `[ymin, xmin, ymax, xmax]` in 0–1000 range; update prompt schema

## 9. Feature Popup Settings

- [x] 9.1 Add `showFeaturePopups` boolean setting to `settingsStore` (default true) with UI toggle in Settings -> General
- [x] 9.2 Add "Don't show again" checkbox to all feature tour popups and coach marks; wire dismissal state to `settingsStore`

## 10. Section Mention Context (`#`)

- [x] 10.1 Fix `useDocumentSections` to properly parse document outline headings and resolve plain text ranges for each section
- [x] 10.2 Wire `#` mention selection to inject bounded section content into the LLM system/user context payload

## 11. In-App Web Browser

- [x] 11.1 Implement URL navigation in `WebBrowserTab` via Tauri Rust HTTP client (server-side fetch) to bypass CORS/CSP
- [x] 11.2 Add CSP/X-Frame-Options fallback: extract main article text and display in reader-friendly format when full rendering is blocked

## 12. Document Interval Modifier & Remaining Days

- [x] 12.1 Apply `interval_modifier` as post-FSRS multiplier in the document rating flow (`final_interval = round(fsrs_interval * interval_modifier)`)
- [x] 12.2 Apply `interval_modifier` in the postpone engine for document postponement calculations
- [x] 12.3 Add interval modifier numeric input (0.1x–5.0x, step 0.1) to Document Details panel and Reader Header with extreme-value warning
- [x] 12.4 Add remaining days badge to document cards and reader header: compute `round(due_date - today)` and display "Due in N days" / "Due today" / "Overdue by N days"

## 13. First Repetition Tracking

- [x] 13.1 Set `first_reviewed_at` on first review: conditional UPDATE with `WHERE first_reviewed_at IS NULL` alongside review log INSERT
- [x] 13.2 Display "First Reviewed" timestamp in Document Inspector, Review Transparency Panel, and Analytics views

## 14. Overdue Metadata

- [x] 14.1 Calculate `overdue_days = max(0, floor(today - due_date))` for queue items and display "Outstanding since [date] (N days overdue)" in queue rows
- [x] 14.2 Add "Overdue Days (Descending)" sort option to queue sort controls
