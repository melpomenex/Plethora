## ADDED Requirements

### Requirement: Local-first multi-stage hybrid retrieval engine
The system SHALL provide a local-first retrieval engine for product documentation combining full-text search (BM25 / SQLite FTS5), alias/synonym matching, metadata filtering, and semantic cosine similarity. The entire documentation corpus SHALL NEVER be passed into an LLM prompt.

#### Scenario: Sub-50ms local search execution
- **WHEN** a user enters a query in the Command Palette
- **THEN** local lexical and alias retrieval returns ranked candidate documentation chunks in under 50ms without network access or LLM invocation.

#### Scenario: Bounded candidate context
- **WHEN** a query triggers grounded synthesis
- **THEN** the retrieval engine extracts only the top-k relevant document sections (k ≤ 5), enforcing a strict token budget of ≤1,500 prompt tokens for documentation context.

### Requirement: Contextual application state boosting
The retrieval engine SHALL accept structured, privacy-sanitized application state (active view, document format, TTS state, selected scheduling algorithm, platform, active modal) and apply relevance boosts to related documentation chunks.

#### Scenario: Vague contextual question resolution
- **WHEN** a user is in the Desktop EPUB viewer with TTS active and asks "Why isn't this scrolling?"
- **THEN** the retrieval engine boosts chunks matching `tts.auto_scroll`, `tts.word_highlighting`, and `reader.epub.scroll_mode` above unrelated generic scrolling documents.

### Requirement: Semantic retrieval with graceful zero-LLM degradation
The retrieval engine SHALL utilize local lightweight embeddings (or on-device LiteRT / EmbeddingGemma when available) for semantic matching, but MUST degrade gracefully to BM25 full-text and alias search if vector inference is unavailable, disabled, or unconfigured.

#### Scenario: Retrieval works completely offline without AI dependencies
- **WHEN** the application is offline, no LLM provider is configured, and no embedding model is loaded
- **THEN** the help search system returns full search results and direct canonical summaries based on lexical and alias index matching.
