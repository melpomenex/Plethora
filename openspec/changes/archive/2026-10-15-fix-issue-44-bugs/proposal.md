## Why

Users encountered several usability, filtering, and functional bugs in Issue #44: "Due All" filtering omitted learning items/extracts, NotebookLM displayed a connected status without rendering notebooks, the Knowledge Universe graph was off-center, Scroll Mode became stuck on an inescapable "Nothing to Read" state when filters were set to zero, "New Only" showed read/overdue documents, section mentions with `#` failed in document Q&A for EPUB Table of Contents entries, and schedule header strings showed raw unformatted i18n template placeholders.

Fixing these bugs improves queue reliability, document Q&A accuracy, NotebookLM integration feedback, graph visualization alignment, and schedule display clarity.

## What Changes

- **Queue Filtering**:
  - Fix "Due All" queue filtering to properly include documents, extracts, and flashcards across all collection scopes.
  - Fix "New Only" filter in `ReviewQueueView` to filter out read, scheduled, and overdue items (showing strictly new items with no review history or due date).
- **NotebookLM Integration**:
  - Handle CLI connection states and notebook listing failures cleanly so that errors or empty lists are surfaced with actionable feedback instead of displaying a disconnected empty state with a "connected" status badge.
- **Knowledge Universe Graph**:
  - Fix WebGL camera initial framing and target centering so galaxy nodes remain centered within the canvas regardless of panel toggle states or layout timing.
- **Scroll Mode UX**:
  - Add a "Reset Filters" / "Customize Session" action to the Scroll Mode "Nothing to Read" empty state to prevent users from being trapped when session filters yield zero items.
- **Document Q&A Section Mentions (#)**:
  - Update outline section matching to skip zero-length Table of Contents entries and correctly resolve section heading text in EPUB and PDF documents.
- **Schedule Workload Header Formatting**:
  - Pass required parameters or update i18n key usage in `ScheduleWorkloadBand` so template placeholders like `{count}` and `{date}` render formatted values instead of raw placeholders.

## Capabilities

### New Capabilities

- `queue-filter-fixes`: Comprehensive fixes for queue filter modes ("Due All", "New Only"), item type visibility, and Scroll Mode empty state recovery.
- `notebooklm-status-handling`: Robust connection status, notebook listing error recovery, and clear user feedback in NotebookLM page.
- `knowledge-universe-centering`: Stable camera auto-framing and target centering for Knowledge Universe WebGL canvas.
- `document-section-mention-resolution`: Accurate heading text extraction and TOC entry filtering for `#` section references in document assistant.

### Modified Capabilities

None.

## Impact

- **Frontend Components**: `ReviewQueueView.tsx`, `QueueScrollPage.tsx`, `KnowledgeUniverse.tsx`, `AssistantPanel.tsx`, `NotebookLMPage.tsx`, `ScheduleWorkloadBand.tsx`, `sectionIndex.ts`, `reviewUx.ts`.
- **Backend / Tauri Commands**: `get_due_queue_items`, `get_due_learning_items` in Rust `queue.rs` & `repository.rs` for proper collection scoping.
- **API Integrations**: `integrations.ts` and `notebooklm.rs` status check & list operations.
