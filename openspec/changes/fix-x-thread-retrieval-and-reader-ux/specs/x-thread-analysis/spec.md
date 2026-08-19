# X Thread Analysis

## MODIFIED Requirements

### Requirement: Full-Thread Retrieval via ThreadReaderApp (replaces previous single-tweet reconstruction)
The X ingestion pipeline SHALL retrieve complete authored threads through the ThreadReaderApp adapter (ping → unrolled thread → normalize), using X GraphQL/syndication only for optional per-post enrichment and for the single-post fallback. The previous GraphQL timeline-reconstruction approach (`threaded_conversation_with_injections_v2` scanning inside a `TweetResultByRestId` response) SHALL be removed — it never produced multi-post threads.

#### Scenario: Previous behavior superseded
- **WHEN** a multi-post thread URL is opened
- **THEN** the backend SHALL NOT rely on scanning a single-tweet GraphQL response for a conversation timeline
- **AND** SHALL instead resolve the thread through the ThreadReaderApp pipeline (see `x-thread-reader-native`)

### Requirement: Structured Model Persisted and Restored
X thread documents SHALL persist the normalized `TwitterThread` model (via `structured_content`) and restore it as `metadata.xThread` on load, so the native viewer and the post-boundary AI context work identically before and after app restarts.

#### Scenario: Thread opened after restart
- **WHEN** a saved X thread document is opened after an app restart
- **THEN** `mapDocument` restores `metadata.xThread` from the persisted `structured_content`
- **AND** the AI context and reader both operate on the restored model

### Requirement: Presentation via Native Viewer (replaces HTML-document display)
X thread content SHALL be presented by the dedicated native `XThreadViewer` (see `x-thread-reader-native`) instead of the generic HTML iframe/document pipeline.

#### Scenario: Previous display path superseded
- **WHEN** a document has `metadata.xThread`
- **THEN** the viewer renders the native `XThreadViewer`
- **AND** generated `articleHtml` is no longer the primary display representation for threads (kept only for export/compatibility)
