## ADDED Requirements

### Requirement: Position-only journal records are compact and explicitly scoped
A position-only document mutation SHALL journal one bounded record containing document identity, position fields, required ordering/protocol information, and explicit ownership of only the position field group. It SHALL NOT include document content, article metadata, unrelated settings, or advance unrelated field-group clocks. Existing local-only restrictions and encryption SHALL continue to apply.

#### Scenario: Position-only update on a large document
- **WHEN** the reader saves a new position on a sync-eligible multi-megabyte article
- **THEN** exactly one compact position record is journaled for that saved sample
- **AND** its bytes and ordering state contain no unrelated document field groups

#### Scenario: Restricted document position
- **WHEN** the user saves a position in a local-only document
- **THEN** local resume behavior succeeds without creating an uploadable record

### Requirement: Compact positions converge without replacing document state
Upgraded receivers SHALL apply compact position records using position-field ordering, alias resolution, tombstone protection, and idempotent replay. They SHALL accept existing full-document and legacy compact records. Position-only records SHALL NOT clear unrelated fields, resurrect deleted documents, suppress the full record needed to materialize a missing document, or silently lose a deferred position. Additive wire fields SHALL remain readable by the previous compact decoder, with older receiver ordering limitations documented.

#### Scenario: Concurrent content edit and position update
- **WHEN** two devices separately edit article content and advance its position offline, then exchange records in either order
- **THEN** upgraded receivers retain both winning content and winning position without changing unrelated metadata or flags

#### Scenario: Position arrives before document creation
- **WHEN** a compact position arrives before the corresponding full document record
- **THEN** it remains recoverable and is applied after materialization
- **AND** it does not prevent that full document record from creating the document

#### Scenario: Stale duplicate or deleted target
- **WHEN** a stale or duplicate position is replayed through an alias or against a tombstoned document
- **THEN** deterministic ordering prevents regression, duplicate effects, or resurrection

#### Scenario: Existing protocol records
- **WHEN** an upgraded receiver processes an existing full-document record or legacy compact position record
- **THEN** valid source data and resume fields remain readable under the documented compatibility behavior
