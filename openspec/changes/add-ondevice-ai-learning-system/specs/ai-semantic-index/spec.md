## ADDED Requirements

### Requirement: Semantic chunking with source-location metadata

The system SHALL chunk documents, extracts, notes, annotations, and card fronts into semantic
chunks via a heading-aware recursive splitter with bounded size and overlap. Every chunk SHALL
store metadata sufficient to navigate back to its origin: document id, source type, ordinal,
EPUB CFI range or PDF page or text offsets as applicable, heading hierarchy, content hash,
token count, and embedding version.

#### Scenario: EPUB chunk navigates back
- **WHEN** a retrieval result from an EPUB chunk is used for navigation
- **THEN** the viewer can jump to the chunk's CFI location within its document

#### Scenario: Heading boundaries are respected
- **WHEN** a document has headings
- **THEN** chunks do not silently span unrelated sections; heading paths are recorded per chunk

### Requirement: Embedding provider abstraction with on-device backend

Embeddings SHALL be produced behind a provider interface. The default Android backend SHALL be
the on-device embedding model (EmbeddingGemma via LiteRT) downloaded only on explicit user
action; desktop SHALL use locally hosted or explicitly configured cloud embedding providers.
Embedding model identity and version SHALL be persisted with every stored vector. When no
embedding provider is available, the retrieval interface SHALL still operate in lexical-only
mode.

#### Scenario: On-device embeddings work offline
- **WHEN** the embedding model is downloaded and the device is offline
- **THEN** indexing and semantic retrieval continue to function without network access

#### Scenario: Embedding model change triggers versioned reindex
- **WHEN** the embedding model or version changes
- **THEN** previously stored vectors are marked stale and re-embedded incrementally, with the
  index remaining queryable (lexical mode) during reindexing

### Requirement: Incremental indexing lifecycle

Indexing SHALL be incremental and interruption-safe: per-chunk commits, enqueue-on-change
driven by content hashes, cascade deletion with documents, and a per-document state machine
(unindexed, queued, indexing, indexed, stale, failed) that is surfaced to the UI. Indexing
SHALL run as background work off the UI thread, SHALL NOT block document opening or reading,
and bulk backfill SHALL respect foreground/background and battery constraints with pause,
resume, and cancel controls.

#### Scenario: Editing one document reindexes only that document
- **WHEN** a document's content changes
- **THEN** only that document's stale chunks are re-embedded; no library-wide re-embedding
  occurs

#### Scenario: Interrupted indexing resumes safely
- **WHEN** indexing is interrupted by app exit or cancellation
- **THEN** already-committed chunks are retained and the document resumes from the stale/queued
  state on the next run

#### Scenario: Reading is never blocked by indexing
- **WHEN** a large library is being backfilled
- **THEN** document-open latency is unaffected and reading interactions proceed concurrently

### Requirement: Retrieval API with lexical fallback and prefilter

The system SHALL expose one retrieval interface (`retrieve(query, k, filters)`) that combines
a lexical prefilter with vector similarity and returns ranked chunks with their metadata and a
mode indicator (semantic or lexical-only). Retrieval latency SHALL meet the performance gate
at the indexed-chunk counts defined in the performance budgets.

#### Scenario: Retrieval without embeddings
- **WHEN** the semantic index is empty or the embedding provider is unavailable
- **THEN** retrieval returns lexical results flagged as lexical-only rather than failing

#### Scenario: Ranked semantic results include metadata
- **WHEN** a semantic query returns top-k chunks
- **THEN** each result carries its navigation metadata and similarity score

### Requirement: Index data is rebuildable cache

Chunk and embedding stores SHALL be treated as rebuildable derived data: they SHALL NOT be
required as source of truth for any user data, and a reset command SHALL be able to wipe and
rebuild the index without loss of user content.

#### Scenario: Index reset loses nothing
- **WHEN** the user resets the semantic index
- **THEN** documents, extracts, cards, and notes are unchanged and indexing restarts from
  scratch in the background

### Requirement: Index status visibility

The system SHALL surface indexing state (per-document and aggregate), storage consumed, and
model/download state in settings, and SHALL allow the user to pause, resume, or reset
indexing.

#### Scenario: Settings show index state
- **WHEN** a user opens AI/index settings
- **THEN** they see indexed counts, pending/failed states, storage usage, and the active
  embedding provider with its download state
