## ADDED Requirements

### Requirement: Every arXiv HTML entry point uses one canonical orchestration
The dedicated arXiv HTML action and generic arXiv `/abs/` or `/html/` URL action SHALL invoke one shared store-level canonical article orchestration. That orchestration SHALL own source resolution, canonical and in-flight deduplication, `importArticle` extraction, normalization, sanitization, retention, and web-article persistence. No reachable arXiv HTML action MAY persist the legacy generically processed full page.

#### Scenario: Dedicated HTML import uses the article pipeline
- **WHEN** a user selects HTML for a valid arXiv paper in the dedicated arXiv dialog
- **THEN** the store resolves the paper's canonical abs URL and invokes the shared canonical article orchestration
- **AND** the persisted document has `metadata.webArticle` and canonical `.inc-article > .inc-body` content
- **AND** the legacy arXiv HTML download/`processHtmlContent` persistence branch is not called

#### Scenario: Generic arXiv URL uses the same orchestration
- **WHEN** a user imports the same paper through an arXiv `/abs/` or `/html/` URL from the URL dialog, command palette, toolbar, or share target
- **THEN** the request reaches the same canonical orchestration and persisted representation as the dedicated HTML import

#### Scenario: Invalid arXiv input fails before persistence
- **WHEN** the dedicated HTML action receives an input that cannot be parsed as a valid arXiv identifier or URL
- **THEN** it reports the existing import error contract and creates no document or source snapshot

### Requirement: Dedicated and generic imports have canonical parity
For the same arXiv paper and extraction version, dedicated HTML and generic URL imports SHALL persist equivalent canonical body text, semantic heading sequence, canonical source URL, extractor provenance, and `.inc-article` / `.inc-body` structure. Dedicated import metadata MAY add research category, priority, tags, paper identifiers, subject categories, and known arXiv URLs, but MUST NOT replace or fork the canonical title or normalized body.

#### Scenario: Separate clean imports produce equivalent canonical bodies
- **WHEN** the dedicated and generic paths import the same deterministic arXiv fixture into separate clean stores
- **THEN** their persisted canonical body text, heading sequence, canonical abs URL, extractor, extraction version, and structural hooks are equivalent
- **AND** any differences are limited to the documented additive dedicated-import policy

#### Scenario: Dialog metadata enriches a new document
- **WHEN** `ArxivImportDialog` supplies an already-fetched `ArxivPaper` while creating a new canonical document
- **THEN** the store uses that data to add safe arXiv identifiers, URLs, categories, research tags, category, or priority without a duplicate Atom lookup
- **AND** pipeline-derived canonical content remains authoritative

#### Scenario: Metadata enrichment failure does not revive legacy HTML
- **WHEN** optional arXiv metadata lookup fails but canonical source resolution and extraction succeed
- **THEN** the canonical HTML import succeeds with pipeline provenance
- **AND** it does not fall back to the legacy HTML representation

### Requirement: Canonical URL and in-flight deduplication are shared
The shared orchestration SHALL resolve an arXiv `/abs/` URL as the deduplication and in-flight key before extraction. `/abs/`, `/html/`, and dedicated identifier forms of the same paper SHALL converge on that key. Pre-fetch and post-fetch canonical checks SHALL return the existing document instead of creating a duplicate.

#### Scenario: Concurrent dedicated and generic imports share one operation
- **WHEN** dedicated HTML and generic `/html/` imports for the same paper begin before either finishes
- **THEN** both calls share one canonical in-flight promise keyed by the abs URL
- **AND** at most one document and one retained source snapshot are created

#### Scenario: Existing canonical document is returned unchanged
- **WHEN** a canonical document for the resolved abs URL already exists and a dedicated import supplies extra research metadata
- **THEN** the existing document is surfaced without changing its category, priority, tags, canonical body, or user metadata

### Requirement: Canonical web-article persistence remains atomic
New arXiv HTML imports SHALL use the existing web-article persistence boundary to create the document, retain an optional source snapshot according to current policy, call `updateWebArticle` with canonical HTML and `WebArticleProvenance`, and apply new-document-only persistence policy. A failed canonical extraction or persistence step SHALL NOT leave a misleading legacy-style HTML document.

#### Scenario: Successful import records provenance
- **WHEN** the shared pipeline successfully imports an arXiv article
- **THEN** the stored metadata includes canonical source URL, final fetch URL, extractor identity, fetch mode, warnings, import timestamp, and the bumped extraction version
- **AND** stored content is the final sanitized canonical article

#### Scenario: Persistence failure follows existing cleanup behavior
- **WHEN** web-article persistence fails after a document has been provisionally created
- **THEN** the shared orchestration follows the existing cleanup/error contract
- **AND** it does not retry through the legacy arXiv HTML path

### Requirement: ArXiv PDF behavior is unchanged
The dedicated arXiv PDF action and existing default-format arXiv callers SHALL continue to use the legacy PDF metadata/download/persistence path. Direct arXiv PDF URLs SHALL remain governed by the existing direct-file import behavior and SHALL NOT be routed through the HTML article pipeline.

#### Scenario: Dedicated PDF import remains on the PDF path
- **WHEN** a user selects PDF in the dedicated arXiv dialog or calls the arXiv action without an explicit format
- **THEN** the store invokes the PDF import utility and persists a PDF document under the existing contract
- **AND** `importArticle` is not invoked for the PDF payload

### Requirement: Existing stored arXiv HTML is not migrated implicitly
The import change SHALL apply to future arXiv HTML imports only. Opening, deduplicating, or updating an existing legacy arXiv HTML document MUST NOT silently re-extract its body or add `metadata.webArticle`. Any future reprocess operation SHALL require an explicit user action and is outside this change.

#### Scenario: Legacy document survives upgrade unchanged
- **WHEN** a library contains an arXiv HTML document created by the former dedicated path
- **THEN** upgrading and opening Plethora preserves its content and metadata bytes unless the user performs an existing explicit edit

