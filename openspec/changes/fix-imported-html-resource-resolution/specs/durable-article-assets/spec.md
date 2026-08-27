## ADDED Requirements

### Requirement: Ingestion failure degrades to the remote URL

When a discovered figure cannot be ingested (network failure, HTTP error, timeout, size/MIME rejection, aggregate-limit rejection), the persisted `img` MUST retain its already-absolutized remote `http(s)` URL instead of having its `src` removed. A failed download MUST NOT fail the article import, and MUST NOT leave an `img` whose `src` is empty or rewritten to a non-image document URL. User cancellation remains the only fatal ingest outcome.

#### Scenario: Figure download 404s

- **WHEN** an imported article contains `https://arxiv.org/html/2410.07524v1/2410.07524v1/upcycle.png`-style dead links (or any 404 figure) and ingestion fails for them
- **THEN** the persisted `img` keeps the remote absolute URL, the import succeeds, and the failure is counted in asset diagnostics

#### Scenario: Degraded figures render as images or nothing — never the broken-page artifact

- **WHEN** the reader displays an article whose figure ingestion failed
- **THEN** the figure either loads from its remote URL or is omitted entirely; it MUST NOT render as an `<img>` whose source is the article's own HTML URL

#### Scenario: Cancellation still aborts

- **WHEN** the user cancels during asset ingestion
- **THEN** the import is aborted as before and no partially rewritten article is persisted

### Requirement: Explicit re-import repairs previously imported documents

Documents eligible for canonical re-import (HTML documents with canonical-article provenance, or legacy arXiv HTML documents with a stored source URL) MUST offer a user-initiated re-import action that re-runs the current pipeline and replaces the stored body and asset references. Stored documents MUST NOT be silently rewritten by upgrade or by opening them; re-import always requires explicit user action and network access, and preserves the document's identity, category, and tags.

#### Scenario: Broken arXiv import is repaired

- **WHEN** a user selects re-import on a document whose figures were persisted with doubled-version 404 URLs
- **THEN** the body is re-extracted with correct resource-base semantics, figures are re-ingested, and provenance is refreshed

#### Scenario: Legacy arXiv HTML can opt into the canonical pipeline

- **WHEN** a user selects re-import on a legacy arXiv HTML document (no canonical provenance, but a stored arXiv HTML/abs URL)
- **THEN** the document is re-imported through the canonical pipeline and its provenance becomes canonical

#### Scenario: Re-import without network fails actionably

- **WHEN** re-import is attempted with no network access
- **THEN** the action fails with a clear error and the stored document is left unchanged
