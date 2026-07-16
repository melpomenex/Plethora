## ADDED Requirements

### Requirement: Startup data is coordinated by collection and visible surface

The app SHALL expose one idempotent startup-loading operation that resolves the available collections and active collection before issuing collection-scoped document, queue, or progress reads. Concurrent callers for the same startup epoch and collection SHALL share the in-flight work, and a collection change SHALL create a new loading key.

#### Scenario: Cold boot resolves the active collection before scoped reads

- **WHEN** the app starts with a persisted active collection that is not yet present in frontend state
- **THEN** the startup operation loads the collection list and active id first, then issues only reads scoped to that active id
- **AND** it does not first load the default collection and later replace it as a side effect of collection hydration

#### Scenario: Mounted tabs request the same startup data

- **WHEN** Dashboard, Queue, and another mounted tab request startup data during the same boot epoch
- **THEN** the coordinator performs one shared startup load for the requested surface/data set
- **AND** each caller receives the same success or failure result without issuing duplicate equivalent IPC/database requests

#### Scenario: Active collection changes after startup

- **WHEN** the user switches from collection A to collection B
- **THEN** the coordinator invalidates collection A's scoped data and loads collection B using a distinct key
- **AND** rows from collection A are not presented as collection B's startup result

### Requirement: The first local response is bounded and summary-only

The startup response SHALL return explicit page metadata and SHALL be bounded by configurable limits of no more than 50 document summaries, no more than 50 queue items, and 256 KiB serialized payload by default. Startup summaries MUST NOT include full document content, embeddings, raw document metadata, or inline cover bytes.

#### Scenario: Large local database

- **WHEN** the database contains more rows than the startup limits
- **THEN** the response returns only the bounded first page/preview with `total` and `hasMore` information
- **AND** the app can request later pages without reloading the first page or clearing visible data

#### Scenario: Summary fields are sufficient for the first screen

- **WHEN** the startup response is applied to the document and queue stores
- **THEN** titles, identity, collection, type, dates, progress/scheduling values, counts, tags needed for visible filtering, and archive/favorite/dismissed flags are available
- **AND** full content and detail-only fields remain available through the existing detail/on-demand APIs

#### Scenario: Payload budget would be exceeded by a row set

- **WHEN** the next page item would make the startup response exceed its byte budget
- **THEN** the backend stops before that item, reports `hasMore`, and does not silently truncate a persisted title or content field
- **AND** the frontend remains able to fetch the omitted item through normal pagination

### Requirement: Only the visible surface loads eagerly

Inactive mounted tabs SHALL NOT start their normal initial database reads. The active surface SHALL consume the startup snapshot or a bounded page, while full-library, analytics, cover, sync-registration, and enrichment work SHALL run after local readiness or on demand.

#### Scenario: Dashboard is the restored active tab

- **WHEN** the app restores Dashboard as the active tab while Queue remains mounted but hidden
- **THEN** Dashboard can render its startup preview and non-critical analytics can load after it
- **AND** Queue does not issue its full queue load until Queue becomes active

#### Scenario: Queue is opened immediately

- **WHEN** the user activates Queue before background hydration completes
- **THEN** Queue renders the bounded queue preview or requests one bounded queue page
- **AND** it does not issue overlapping full-queue loads caused by both the shell and the tab effect

#### Scenario: Background hydration runs on a low-tier device

- **WHEN** additional pages, covers, sync registration, or enrichment are scheduled after local readiness
- **THEN** the work is bounded, cancellable, and yields to user input
- **AND** a background failure does not clear or replace the already-visible startup data

### Requirement: Native startup preserves database safety and query scope

Normal frontend database commands SHALL remain gated until database open, integrity handling, and migrations have completed. Startup queries SHALL use explicit summary projections, the resolved collection scope, and query plans/indexes appropriate to document ordering and queue due selection. Corruption recovery and empty/legacy database behavior SHALL remain unchanged.

#### Scenario: Backend is still migrating

- **WHEN** a frontend startup request arrives before the native backend is ready
- **THEN** the request waits for the existing backend-ready gate
- **AND** no query runs against a partially migrated schema

#### Scenario: Corrupt database is recovered

- **WHEN** the database fails its startup integrity check
- **THEN** the existing quarantine-and-recreate behavior and startup notice remain in effect
- **AND** the coordinator surfaces an empty/recovery state without treating stale pre-recovery rows as valid data

#### Scenario: Collection-scoped query plan

- **WHEN** the startup command loads document summaries or due queue items for an active collection
- **THEN** the native repository uses explicit columns and a bounded ordered query that can use the verified collection/date or due-date indexes
- **AND** it does not fall back to `SELECT *` or load unbounded content columns for the startup path

### Requirement: Startup performance is measurable and regression-tested

The app SHALL record backend readiness, startup command, collection readiness, first document data, first queue data, and background hydration as separate diagnostic phases, including duration, item count, serialized bytes, and outcome without retaining document content. The reference benchmark SHALL enforce p95 first local data within 1,000 ms on the Boox Palma 2 profile and within 500 ms on the desktop profile for a large local fixture, subject to the documented benchmark environment.

#### Scenario: Successful cold-start benchmark

- **WHEN** the benchmark launches with sync disabled and a fixture of approximately 1,000 documents and 5,000 learning items
- **THEN** it reports each startup phase and verifies the first local data target, startup item limits, and payload budget
- **AND** it confirms hidden tabs did not add equivalent startup reads

#### Scenario: Slow or empty database

- **WHEN** SQLite or IPC is slow, or the database is empty
- **THEN** telemetry records the delay/empty result and the shell remains usable with a loading or empty state
- **AND** the app does not retry the same startup operation in an unbounded loop

#### Scenario: Startup failure and retry

- **WHEN** the coordinated startup operation fails after the shell has mounted
- **THEN** the user receives a recoverable error state and an explicit retry can run the affected load again
- **AND** successful domains and existing visible state are not cleared as collateral damage
