## ADDED Requirements

### Requirement: Extraction provenance is persisted
Every imported article SHALL record its original URL, canonical/resolved URLs, selected extraction engine, extraction score and confidence, extraction version, import timestamp, whether rendered fallback was used (and why), and bounded per-candidate diagnostics, stored additively in document metadata.

#### Scenario: Provenance queryable
- **WHEN** an imported article is inspected after import
- **THEN** its metadata identifies the engine, version, score, confidence, original/canonical URLs, and fallback usage

### Requirement: Canonical content representation is stored
Imported articles SHALL store the sanitized semantic article HTML as the document's rich content and a normalized plain-text derivative for word count, search, and AI features; an HTML → Markdown → HTML round-trip SHALL NOT be the canonical path.

#### Scenario: Article body is semantic HTML
- **WHEN** an article is persisted
- **THEN** its `content` is the sanitized canonical article HTML and its metadata/derived fields include the plain-text word count

### Requirement: Raw source snapshots enable reprocessing
The pipeline SHALL retain the fetched raw HTML as a gzip snapshot referenced from document metadata (skipped with a diagnostic above a size cap), governed by a retention setting that can disable snapshots and delete existing ones, enabling future re-extraction at a higher extraction version without re-sharing the URL; snapshots SHALL be excluded from cloud backups by default and this storage trade-off SHALL be documented.

#### Scenario: Snapshot stored on import
- **WHEN** an article imports successfully with snapshots enabled
- **THEN** the raw source is stored compressed and referenced (path, digest, sizes) from metadata

#### Scenario: Retention disabled
- **WHEN** the user turns off raw-source retention
- **THEN** existing snapshots are deleted and new imports skip snapshot storage while articles remain intact

### Requirement: Canonical-URL duplicate detection
Before creating a document, the pipeline SHALL detect existing or in-flight imports of the same canonical URL (falling back to the normalized original URL) and SHALL surface the existing document instead of creating a duplicate; rapid re-share and app-resume lifecycle events SHALL NOT produce duplicate documents or duplicate downloads.

#### Scenario: Same article shared twice
- **WHEN** the same article URL (after normalization) is shared again while an identical document exists
- **THEN** the user is pointed at the existing document and no second document is created

#### Scenario: Concurrent shares
- **WHEN** multiple URLs are shared in rapid succession
- **THEN** imports are processed without orphaned work, and any in-flight duplicate URL coalesces

### Requirement: Backward compatibility and additive schema
Existing web-imported documents SHALL continue to render unchanged through the legacy viewer path; all new persisted fields SHALL be additive and optional so older clients restoring a database containing them ignore them; no automatic rewrite of existing articles SHALL occur; reprocessing pre-existing imports SHALL remain an explicit future action, not an automatic migration.

#### Scenario: Old imports untouched
- **WHEN** the app runs after the upgrade
- **THEN** documents imported by the old flattening pipeline render exactly as before and are never rewritten

#### Scenario: Older client restores newer backup
- **WHEN** a database containing `webArticle` metadata is opened by a client version without the new pipeline
- **THEN** the unknown metadata fields are ignored and the documents remain functional
