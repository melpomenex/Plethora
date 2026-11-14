## ADDED Requirements

### Requirement: Unified SQLite FTS5 library search (`palette_search`)
The backend SHALL provide a unified FTS5 search command (`palette_search`) searching across `document_search`, `extract_search`, `transcript_search_fts`, `semantic_chunks_fts`, `rss_articles_fts`, annotations, and flashcards (`learning_items`) with safe FTS5 query escaping (handling punctuation, hyphens, colons, operators, and unmatched quotes), BM25 relevance ranking, scope and metadata filtering, clean HTML-stripped snippets, and pagination/total counts without full-table scans.

#### Scenario: Punctuated and multi-term queries execute safely against FTS5 across full library
- **WHEN** a user searches for `"C++ vector"`, `"don't stop"`, or `"http://example"` across a 10,000-document SQLite database
- **THEN** `palette_search` sanitizes the query safely without SQLite FTS5 syntax errors
- **AND** returns ranked matches with exact page, CFI, timestamp, or quote anchors and HTML-stripped highlighted snippets within target latency budgets
