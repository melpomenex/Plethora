## ADDED Requirements

### Requirement: PDF zoom mode and custom scale persist per document

Plethora SHALL persist each PDF's `zoomMode` (`custom`, `fit-width`, `fit-page`) and custom numerical `scale` per document across tab switches, document switches, and application restarts, even when the user changes zoom without scrolling.

#### Scenario: Two PDFs retain independent zoom preferences

- **WHEN** the user sets PDF A to 175% custom zoom and PDF B to Fit Width, then switches between them or restarts
- **THEN** PDF A restores at 175% custom zoom and PDF B restores in Fit Width mode (adapting to viewport width)

### Requirement: arXiv tables scroll locally without clipping or widening the reader

Wide tables in canonical and legacy arXiv HTML documents SHALL scroll horizontally within their own wrapper container while preserving all columns and never causing horizontal overflow of the article root.

#### Scenario: Wide arXiv benchmark table is fully reachable

- **WHEN** an arXiv paper with a wide multi-column table is rendered at desktop or mobile width with or without the Assistant panel open
- **THEN** the table's final column is reachable by horizontal scrolling inside `.inc-table-wrap` (or `.ltx_tabular`)
- **AND** `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`

### Requirement: Newly imported documents are automatically indexed for semantic retrieval

Every supported document import pathway producing usable, authorized text SHALL automatically enqueue the document into the canonical `ai_learning` indexing pipeline and reconcile unindexed/stale documents on startup, respecting cloud billing consent and document privacy flags.

#### Scenario: Imported document becomes RAG-searchable without manual reindex

- **WHEN** a user imports a document with usable text
- **THEN** the document is automatically enqueued, chunked, and indexed (with embeddings when an authorized provider is available, or lexical FTS5 otherwise)
- **AND** querying a fact from the document via `ai_learning_retrieve` returns the relevant chunk and provenance

### Requirement: PDF `#` section mentions resolve to actual section body text

Selecting a PDF section via `#` in the Assistant SHALL resolve to the section's actual body text (never a 0-token or ~8-token heading-only or TOC-line slice) before assembling the AI provider request.

#### Scenario: Selecting a PDF outline section includes its body text

- **WHEN** the user selects a PDF section with `#` in the Assistant
- **THEN** the resolved section context contains the section's body text and accurate token estimate
- **AND** heading-only or unresolved sections are clearly surfaced rather than silently sent as empty or heading-only context
