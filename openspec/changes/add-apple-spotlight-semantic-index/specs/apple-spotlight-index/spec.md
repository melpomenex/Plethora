## ADDED Requirements

### Requirement: Core Spotlight is a derived index over SQLite

The system SHALL treat Core Spotlight as a rebuildable projector of library items. Canonical storage SHALL remain SQLite tables `documents`, `extracts`, `learning_items`, and `semantic_chunks` (created by migration `085_ai_learning_system` in `src-tauri/src/database/migrations.rs`). Spotlight SHALL NOT be required to open, sync, or persist user content. Resetting or deleting the Spotlight domain SHALL NOT delete user documents, extracts, or cards.

#### Scenario: Spotlight wipe leaves the library intact
- **WHEN** the Spotlight domain is deleted (index reset, logout, or corruption recovery)
- **THEN** rows in `documents`, `extracts`, and `learning_items` are unchanged
- **AND** `semantic_chunks` are only removed if the existing `ai_learning_reset_index` path runs, which already rebuilds them from user content

#### Scenario: Opening a hit loads SQLite, not Spotlight text
- **WHEN** the user selects a Spotlight-augmented search result
- **THEN** navigation uses the canonical id parsed from the URI to load the document, extract, or card from SQLite
- **AND** Spotlight body text is not treated as source of truth

### Requirement: Deterministic plethora URI identity

Donated `CSSearchableItem.uniqueIdentifier` values SHALL be deterministic URIs derived from existing primary keys:

- `plethora://document/<id>` from `documents.id`
- `plethora://chunk/<chunk_id>` from `semantic_chunks.id`
- `plethora://extract/<id>` from `extracts.id`
- `plethora://card/<id>` from `learning_items.id`

The system SHALL NOT persist `appleSpotlightIdentifier` or any Apple-specific identifier column on `documents` or other user tables. Mapping SHALL be a pure function shared by Rust and Swift.

#### Scenario: Document URI round-trips
- **WHEN** a document with id `D` is donated
- **THEN** the unique identifier is `plethora://document/D`
- **AND** parsing that identifier yields kind document and id `D`

#### Scenario: Chunk URI uses semantic_chunks.id
- **WHEN** a chunk row with id `C` is committed by `src-tauri/src/ai_learning/indexer.rs`
- **THEN** the donated identifier is `plethora://chunk/C`
- **AND** a content update re-donates the same identifier rather than minting a new one

#### Scenario: No Apple id column on documents
- **WHEN** the schema for `documents` is inspected after this change
- **THEN** there is no `appleSpotlightIdentifier` (or equivalent) column
- **AND** rebuilds remain possible without migrating stored Apple ids

### Requirement: System Spotlight display is opt-in and off by default

Donated items SHALL NOT be eligible for system-wide Spotlight display unless the user enables `settings.search.systemSpotlightEnabled`. That setting SHALL default to **false** in `src/stores/settingsStore.ts` / `src/types/settings.ts`. Items SHALL have `isEligibleForPublicIndexing` false. In-app querying of the donated index MAY run while display eligibility is false. If the OS cannot query non-display items, the system SHALL use FTS rather than enabling system display automatically.

#### Scenario: Default install stays out of system Spotlight
- **WHEN** a user has never changed search settings
- **THEN** `settings.search.systemSpotlightEnabled` is false
- **AND** donated items are not eligible for system Spotlight display

#### Scenario: User opts in
- **WHEN** the user sets `settings.search.systemSpotlightEnabled` to true
- **THEN** subsequent donations (or a rebuild of eligibility) mark items eligible for system display
- **AND** SQLite user content is not rewritten

#### Scenario: OS cannot query hidden items
- **WHEN** in-app `CSUserQuery` cannot search items that are ineligible for display
- **THEN** search uses existing FTS (`src/api/ftsSearch.ts`)
- **AND** the app does not flip `systemSpotlightEnabled` on by itself

### Requirement: Indexer-driven lifecycle

Spotlight updates SHALL hook the existing indexer (`src-tauri/src/ai_learning/indexer.rs`, commands in `src-tauri/src/commands/ai_learning.rs`, TS `src/api/ai-learning.ts`) rather than a second job framework. Lifecycle SHALL cover initial backfill, incremental insert/update, delete, rebuild, logout domain wipe, and corruption recovery.

#### Scenario: Initial backfill
- **WHEN** the Apple Spotlight domain is empty and the indexer runs `enqueue_all` / `enqueueAllAIDocuments`
- **THEN** committed documents, chunks, extracts, and cards are donated with the URI scheme above

#### Scenario: Incremental update
- **WHEN** a document’s content hash changes and the indexer reindexes only that document
- **THEN** only that document’s Spotlight items are upserted
- **AND** unchanged library URIs are not deleted

#### Scenario: Delete and extra sources
- **WHEN** a document is deleted or `removeSourceChunks` / `ai_learning_remove_source_chunks` removes an extract, annotation, or card
- **THEN** the corresponding `plethora://` identifiers are removed from Spotlight

#### Scenario: Rebuild
- **WHEN** the user resets the semantic index via `resetAIIndex` / `ai_learning_reset_index`
- **THEN** the Spotlight domain is deleted first
- **AND** donations resume as indexing backfills
- **AND** user documents remain

#### Scenario: Logout
- **WHEN** the user logs out or wipes the local library (`src/stores/accountStore.ts` / `src/lib/sync-client.ts` `logout()`)
- **THEN** the Spotlight library domain is deleted
- **AND** donated private items do not remain in the system index

#### Scenario: Corruption recovery
- **WHEN** donated-id stats disagree with the SQLite URI set, or the plugin reports a corrupted index
- **THEN** the domain is deleted and a rebuild is enqueued
- **AND** in-app search falls back to FTS until donations catch up

### Requirement: Search UX augments existing surfaces

Spotlight SHALL augment `src/pages/SearchPage.tsx`, `src/components/search/CommandCenter.tsx`, and `src/components/search/GlobalSearch.tsx` via existing result types. The system SHALL NOT add a separate Spotlight search application or merge product-help retrieval (`features/help/helpRetrieval`) into the library domain.

#### Scenario: Command palette shows familiar result types
- **WHEN** Spotlight returns a `plethora://document/<id>` hit
- **THEN** the command palette / GlobalSearch renders it as a document result and opens that document
- **AND** no new `SearchResultType` is required for Spotlight

#### Scenario: Dedup with FTS
- **WHEN** both FTS and Spotlight hit the same canonical id
- **THEN** the UI shows one row
- **AND** FTS-only hits are still shown

### Requirement: FTS fallback

When Core Spotlight is unavailable (`platform_unsupported`, unsupported OS, empty or rebuilding index, or query error), library search SHALL use the existing FTS path (`src/api/ftsSearch.ts` and FTS5 tables used by `src-tauri/src/ai_learning/retrieval.rs` lexical mode) and SHALL NOT fail closed.

#### Scenario: Non-Apple platform
- **WHEN** Spotlight commands run on Android or a stub desktop build
- **THEN** they return `platform_unsupported`
- **AND** SearchPage / command palette still return FTS results

#### Scenario: Plugin error during query
- **WHEN** `apple_spotlight_query` fails
- **THEN** the user still sees FTS results
- **AND** diagnostics record an error category without query or document text

### Requirement: Native plugin module

Spotlight SHALL live in `src-tauri/plugins/plethora-apple-intelligence/` Swift `AppleSpotlight` (commands `apple_spotlight_status`, `apple_spotlight_donate`, `apple_spotlight_delete`, `apple_spotlight_delete_domain`, `apple_spotlight_query`). iOS 18+ APIs SHALL be `@available`-guarded. Deployment target SHALL remain iOS 14. Non-Apple OS SHALL NOT link CoreSpotlight.

#### Scenario: iOS 14 compile
- **WHEN** the Apple project is built with `IPHONEOS_DEPLOYMENT_TARGET = 14.0`
- **THEN** unguarded iOS 18 Spotlight types are not referenced from the default compilation path
- **AND** runtime on iOS 14–17 degrades to FTS for semantic `CSUserQuery`
