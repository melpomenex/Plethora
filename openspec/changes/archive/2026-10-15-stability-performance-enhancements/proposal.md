## Why

Incrementum suffers from severe startup and runtime performance degradation — cold start hangs and basic operations (rating, navigation) lag noticeably. Several core workflows are broken: queue filters don't enforce item-type exclusions, extract navigation from the queue lands on page 1 instead of the extract's position, spurious collections auto-generate, and the extract mode toggle is non-functional. Additionally, users lack visibility into document scheduling (remaining days, overdue status) and have no per-document control over review pacing.

## What Changes

### Bug Fixes
- **Cold start & runtime latency**: Defer non-critical background work, add SQLite indexes on hot-path queries, enforce Zustand selector subscriptions to eliminate cascade re-renders
- **Extract mode toggle**: Wire toggle state to the document viewer state machine with visual indicators across all viewer types
- **Web article import**: Fix import handler to create a proper Document node instead of collapsing content into a single extract
- **Spurious collections**: Ensure default collection seeding runs only once; remove auto-collection creation fallbacks
- **Image occlusion**: Fix canvas coordinate mapping (DPR/scaling) for manual mode; normalize AI bounding box output format
- **Queue filter enforcement**: Hard post-filter step in `computeOptimalQueue` to guarantee item-type exclusions
- **Extract queue navigation**: Pass `extractId` through queue navigation; auto-scroll to extract position in viewer
- **Feature popup dismissal**: Add global setting and per-popup "Don't show again" checkbox
- **Broken `#` section mentions in AI assistant**: Fix `useDocumentSections` to parse headings and inject bounded section content into LLM context
- **In-app web browser**: Handle URL navigation via Tauri webview protocol with CSP/X-Frame-Options fallback

### New Features
- **Document interval modifier**: Per-document multiplier (0.1x–5.0x) applied to scheduling intervals
- **Remaining days display**: Badge showing "Due in N days" or "Overdue by N days" on document cards and reader header
- **First repetition date tracking**: `first_reviewed_at` column on documents and learning_items, exposed in inspector and analytics
- **Overdue days metadata**: Calculated overdue_days with sortable display in queue rows

## Capabilities

### New Capabilities
- `startup-performance`: Deferred boot chain, SQLite indexing, Zustand selector audit
- `extract-mode-toggle`: Wiring extract mode state across document viewer types
- `web-article-import-fix`: Proper Document node creation on web article import
- `collection-seeding-guard`: Idempotent default collection seeding without auto-creation side effects
- `image-occlusion-coordinates`: Canvas coordinate mapping and AI bounding box normalization
- `queue-filter-enforcement`: Hard post-filtering to enforce item-type and percentage constraints
- `extract-queue-navigation`: Extract-aware queue navigation with auto-scroll to extract position
- `feature-popup-settings`: Global and per-popup dismissal controls
- `section-mention-context`: Section heading resolution and LLM context injection for `#` mentions
- `web-browser-tab`: Tauri-native URL navigation with CSP fallback
- `document-interval-modifier`: Per-document interval multiplier for scheduling control
- `remaining-days-display`: Due/overdue badge on document cards and reader header
- `first-repetition-tracking`: First review date tracking and display
- `overdue-metadata`: Overdue days calculation, display, and sorting

### Modified Capabilities
- `document-rating`: Rating flow must apply document-level interval modifier before persisting intervals
- `postpone-engine`: Postpone calculations must respect the document interval modifier

## Impact

- **Database**: New indexes on `documents`, `learning_items`, `review_log` tables; new `first_reviewed_at` column; new `interval_modifier` column on `documents`
- **Stores**: `queueStore`, `documentStore`, `reviewStore`, `collectionStore`, `settingsStore` all affected
- **Components**: `DocumentViewer`, `FlashcardStudio`, `QueueView`, document cards, reader header, settings panel
- **Backend**: Tauri commands for queue computation, document import, web browser proxy
- **Migrations**: At least 2 new SQLite migrations (indexes + schema additions)
