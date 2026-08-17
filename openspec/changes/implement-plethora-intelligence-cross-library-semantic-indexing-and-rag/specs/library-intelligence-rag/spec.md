## ADDED Requirements

### Requirement: Index covers documents, extracts, notes, and annotations
The semantic index (`semantic_chunks`) SHALL support a `source_kind` dimension (document, extract, note, annotation) with change-driven incremental reindexing (debounced, bounded) when covered sources are created or edited, and cascade deletion when removed. An optional per-document "exclude from AI/cloud" flag SHALL prevent that document's content from any cloud processing while permitting local-only indexing when a local backend is selected.

#### Scenario: New highlight becomes searchable
- **WHEN** the user creates an extract and the reindex throttle window closes
- **THEN** `rag_query` can retrieve that extract's content with its citation

#### Scenario: Excluded document stays local
- **WHEN** a document flagged exclude-from-cloud is indexed with a cloud backend selected
- **THEN** its chunks are skipped for cloud embedding and flagged local-pending; with a local backend they index normally

### Requirement: rag_query provides fused, optionally reranked retrieval
`rag_query(query, filters, scope, top_k, mode)` SHALL return `RagHit[]` with metadata (`fused_from`, `reranked`, `elapsed_ms`), fusing FTS5 lexical and vector candidate sets via reciprocal-rank fusion, with an optional rerank stage behind a provider abstraction. Filters SHALL include collection, document type, tag, date range, source_kind, and AI-exclusion.

#### Scenario: Fusion beats single-mode recall
- **WHEN** the golden-set retrieval suite runs against the fixture library
- **THEN** fused recall@8 is ≥ both lexical-only and vector-only recall@8

#### Scenario: Filters constrain results
- **WHEN** scope is limited to one collection
- **THEN** all hits belong to that collection

### Requirement: Citations are first-class and jump to source
Every retrieval hit SHALL carry a normalized `RagCitation { documentId, chunkId, quote, locator, score }` whose locator resolves per format: PDF via page + reflow word anchor, EPUB via CFI, video via timestamp, extracts via extract id. Citation UI SHALL deep-link into the reader at the locator.

#### Scenario: PDF citation jumps to the passage
- **WHEN** the user clicks a PDF citation chip in an assistant answer
- **THEN** the document opens at the cited page/anchor with the quote in view

#### Scenario: Video citation jumps to timestamp
- **WHEN** a citation references a transcript chunk
- **THEN** playback opens at the cited timestamp

### Requirement: Grounded answers validate their citations
The whole-library answer task SHALL assemble retrieved context with numbered markers, require every marker used in the answer to map to a returned hit, and handle the no-relevant-context case explicitly ("not found in your library" style). Provenance SHALL be recorded to `ai_provenance`.

#### Scenario: Marker mapping is enforced
- **WHEN** a model answer references `[3]` but only 2 hits were provided
- **THEN** validation fails and the repair path regenerates or degrades the answer

### Requirement: Cloud intelligence is capability-gated with disclosed privacy
Plethora-hosted embedding/rerank SHALL require the `library_intelligence` capability, run through the shared job framework with token quotas, and return vectors/ranks without server-side persistence beyond job TTL. Settings SHALL disclose what content leaves the device, when, and for what purpose; local backends (on-device Nano, Ollama, user-keyed providers) SHALL remain available without the capability.

#### Scenario: Quota gates cloud embedding
- **WHEN** monthly embedding tokens are exhausted
- **THEN** cloud indexing pauses with `quota_exhausted` reason and offers local/backend alternatives

#### Scenario: Free user keeps full local RAG
- **WHEN** a Free user configures Ollama embeddings
- **THEN** indexing, retrieval, and cited answers work with no capability gate
