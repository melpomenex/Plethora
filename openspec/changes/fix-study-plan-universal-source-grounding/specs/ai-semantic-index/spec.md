## MODIFIED Requirements

### Requirement: Incremental indexing lifecycle
Indexing SHALL be incremental and interruption-safe: per-chunk commits, enqueue-on-change driven by content hashes, cascade deletion with documents, and a per-document state machine (unindexed, queued, indexing, indexed, stale, failed) that is surfaced to the UI. `list_indexable_documents` SHALL consider documents whose indexable text resides in `youtube_transcripts`, `video_transcripts`, `recording_sessions`/`transcripts`, `podcast_transcript_segments`, `html_content`, `extracts`, or `annotations` in addition to `documents.content`, while strictly excluding `is_ai_excluded = 1` documents. Indexing SHALL maintain `semantic_chunks_fts` in sync with `semantic_chunks` via SQLite triggers.

#### Scenario: Editing one document reindexes only that document
- **WHEN** a document's content changes
- **THEN** only that document's stale chunks are re-embedded; no library-wide re-embedding occurs

#### Scenario: Interrupted indexing resumes safely
- **WHEN** indexing is interrupted by app exit or cancellation
- **THEN** already-committed chunks are retained and the document resumes from the stale/queued state on the next run

#### Scenario: Reading is never blocked by indexing
- **WHEN** a large library is being backfilled
- **THEN** document-open latency is unaffected and reading interactions proceed concurrently

#### Scenario: Transcript-only or media-backed document enters index queue without plain documents.content
- **WHEN** a document is backed by `youtube_transcripts`, `video_transcripts`, `recording_sessions`, or `podcast_transcript_segments` while `documents.content` is initially empty
- **THEN** background backfill and explicit index assurance (`ensure_study_sources_indexed`) discover and chunk the document into `semantic_chunks` and `semantic_chunks_fts` unless `is_ai_excluded = 1`

### Requirement: Retrieval API with lexical fallback and prefilter
The system SHALL expose one retrieval interface (`retrieve(query, k, filters)`) that combines a lexical prefilter (`semantic_chunks_fts` and `document_search`) with vector similarity and returns ranked chunks with their metadata and a mode indicator (semantic or lexical-only). Lexical retrieval SHALL query `"transcript"`, `"session"`, `"extract"`, `"annotation"`, `"card"`, and `"document"` chunk types directly so indexed media transcripts return real verifiable chunk IDs rather than ephemeral `fts-*` stubs.

#### Scenario: Retrieval without embeddings
- **WHEN** the semantic index is empty or the embedding provider is unavailable
- **THEN** retrieval returns lexical results flagged as lexical-only rather than failing

#### Scenario: Ranked semantic results include metadata
- **WHEN** a semantic query returns top-k chunks
- **THEN** each result carries its navigation metadata and similarity score

#### Scenario: Lexical retrieval on indexed YouTube transcript returns real chunk ID
- **WHEN** `retrieve` runs in lexical-only or hybrid mode with `filters.documentIds` containing an indexed YouTube document
- **THEN** `lexical_results` returns the matching `"transcript"` chunk from `semantic_chunks` with its stored `chunk_id`, `location.timestampMs`, and `content_hash` rather than synthesizing `fts-<document_id>`
