## Context

Incrementum is a Tauri 2.0 desktop app (Rust backend + React 19 frontend) for incremental reading and spaced repetition. The app has grown to include sync, AI features, podcast/RSS, and flashcard studio — all of which eagerly initialize at startup. The SQLite database lacks indexes on frequently-queried columns, and Zustand stores subscribe without selectors, causing cascade re-renders. Several workflows (extract mode, queue filtering, extract navigation, web import, collections, image occlusion, AI assistant `#` mentions, in-app browser) have broken or regressed. Users also lack visibility into scheduling metadata (remaining days, overdue status) and per-document pacing control.

## Goals / Non-Goals

**Goals:**
- Reduce cold start time to <500ms and eliminate perceptible lag on rating/navigation actions
- Fix all 10 identified bugs across queue, viewer, import, collection, and assistant workflows
- Add document interval modifier, remaining days display, first repetition tracking, and overdue metadata
- All changes are backward-compatible with existing user data

**Non-Goals:**
- Rewriting the scheduling algorithm (FSRS stays as-is; only the interval modifier multiplies its output)
- Redesigning the queue strategy or priority system
- Adding new document formats or import sources
- Mobile-specific UI changes
- Sync protocol changes

## Decisions

### 1. Startup Deferral Strategy
**Decision:** Use `requestIdleCallback` with a 3-second timeout fallback to defer non-critical initialization (sync handshake, RSS polling, analytics, AI model preloading).

**Rationale:** `requestIdleCallback` cooperates with the browser's event loop without blocking first paint. The 3s timeout ensures deferred work still runs on slow machines. Alternative (Web Worker) was rejected because these tasks need main-thread store access.

**Affected files:** `src/App.tsx`, any top-level `useEffect` that triggers background work.

### 2. SQLite Indexing Approach
**Decision:** Add composite indexes via a new migration rather than modifying existing migrations.

Indexes to add:
- `idx_documents_collection_state` on `documents(collection_id, state)`
- `idx_documents_due` on `documents(next_reading_date)`
- `idx_learning_items_document_state` on `learning_items(document_id, state)`
- `idx_learning_items_due` on `learning_items(due)`
- `idx_learning_items_type` on `learning_items(item_type)`
- `idx_review_log_item` on `review_log(item_id, review_date)`

**Rationale:** Separate migration is safer than altering existing ones. Composite indexes cover the JOIN + WHERE patterns used in queue computation. `EXPLAIN QUERY PLAN` should validate each index is hit.

### 3. Zustand Selector Enforcement
**Decision:** Audit all `useXxxStore()` calls (no selector) and replace with `useXxxStore(s => s.field)` or `useShallow` for multi-field selectors.

**Rationale:** Bare `useXxxStore()` re-renders on every state mutation. Selectors are the standard Zustand pattern. `useShallow` from `zustand/react/shallow` handles multi-field cases without custom equality functions.

### 4. Interval Modifier Storage
**Decision:** Add `interval_modifier REAL DEFAULT 1.0` column to the `documents` table. Applied as a post-FSRS multiplier: `final_interval = round(fsrs_interval * interval_modifier)`.

**Rationale:** Post-multiplier is simpler than modifying FSRS parameters per document. The modifier is purely a user-facing pacing control, not a learning parameter. Storing it on the document row avoids a separate table and keeps queries simple.

**Alternatives considered:** Per-collection modifier (rejected — too coarse), FSRS desired_retention override (rejected — changes learning model semantics).

### 5. Extract Navigation via Queue
**Decision:** Extend queue item payload to include `extract_id` and `source_offset`. `DocumentViewer` receives these via route params or store state and uses them to scroll to the extract position on mount.

**Rationale:** The queue already knows the item type and parent document. Adding the extract ID is minimal. The viewer already has scroll-to-position logic for PDF pages; extending it for character offsets in text documents is straightforward.

### 6. Queue Filter Enforcement
**Decision:** Add a hard post-filter step in `queueStore` after `computeOptimalQueue` returns. If `flashcard_ratio === 0`, filter out all flashcard items. Similarly enforce document/extract-only modes.

**Rationale:** The optimal queue algorithm balances item types by ratio, but ratio=0 should be an absolute exclusion, not a "try to minimize." A post-filter is the simplest guarantee without modifying the algorithm internals.

### 7. Web Browser Tab
**Decision:** Use Tauri's `invoke` to fetch URLs server-side (Rust HTTP client), returning sanitized HTML to the frontend webview. Fall back to a readable-text extraction when CSP/X-Frame-Options block iframe rendering.

**Rationale:** Tauri's webview has CSP restrictions that prevent arbitrary iframe loading. Server-side fetch bypasses CORS. A readable-text fallback (similar to Firefox Reader View) ensures content is always accessible even when full rendering isn't possible.

### 8. First Repetition Date
**Decision:** Add `first_reviewed_at DATETIME` to both `documents` and `learning_items`. Populated on INSERT into `review_log` when the column is NULL (single UPDATE with WHERE first_reviewed_at IS NULL).

**Rationale:** Trigger-based approach was considered but adds complexity. A conditional UPDATE alongside the review log INSERT is simpler and equally correct since reviews are serialized.

## Risks / Trade-offs

- **Index size increase** → Acceptable; SQLite indexes are compact and the database is local. Monitor with `PRAGMA page_count` if needed.
- **requestIdleCallback not available in all webviews** → Tauri uses Chromium-based webview on all platforms; `requestIdleCallback` is supported. Add `setTimeout` polyfill as safety net.
- **Interval modifier confusion** → Users might set extreme values (0.1x or 5.0x) and lose track of documents. Mitigate with UI warnings at extreme values and a reset-to-default button.
- **Post-filter on queue may reduce session size** → If the algorithm returns mostly flashcards and the user wants 0% flashcards, the session could be very short. Display a notice when filtering removes >50% of items.
- **Web browser fetch via Rust** → Some sites may block non-browser user agents. Use a realistic User-Agent header. This is a best-effort feature, not a full browser replacement.

## Open Questions

- Should the interval modifier apply to flashcard items within a document, or only to the document's own scheduling? (Current design: document only)
- Should `first_reviewed_at` backfill from existing `review_log` data via a migration, or start fresh? (Recommendation: backfill with `MIN(review_date)` per item)
