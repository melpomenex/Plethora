# Spec Delta: local-data-plane (new)

## ADDED Requirements

### Requirement: No Remote Sync Connections
The application SHALL NOT establish any connection to a remote sync service. No WebSocket sync provider, delta-log HTTP transport, outbox drain, presence heartbeat, or sync-related network request SHALL be initiated under any setting or persisted flag value.

#### Scenario: Boot with stale sync settings
- **WHEN** the application starts with a persisted settings blob containing `sync.yjs.enabled: true` from an older install
- **THEN** the application performs no sync network activity and the stale setting is migrated away

#### Scenario: Sync relay unreachable is irrelevant
- **WHEN** the sync relay hostnames are removed from the CSP and the user attempts no sync action
- **THEN** the application never references any sync relay origin

### Requirement: Boot Without Sync Subsystem Initialization
Application startup SHALL NOT initialize any sync subsystem: no Yjs document, no y-indexeddb persistence, no entity replicators, no sync migration/backfill, and no sync-branded scheduler work SHALL run on the boot path.

#### Scenario: Cold start
- **WHEN** a user cold-starts the application on a fresh or long-lived install
- **THEN** startup completes with zero sync subsystem modules loaded and no sync-related IndexedDB databases opened

### Requirement: Local SQLite Is the Sole Data Plane
All user data SHALL be read from and written to the local SQLite database via domain commands. Domain write paths (reviews, learning items, queue actions, extracts, collections, RSS, podcasts, documents, conversations) SHALL have no sync publish hooks.

#### Scenario: Flashcard review
- **WHEN** the user completes a flashcard review
- **THEN** the review is applied to SQLite and no replication publish step occurs

#### Scenario: Document deletion
- **WHEN** the user deletes a document
- **THEN** the document and its local files are removed locally with no tombstone written to any shared map

### Requirement: No Sync Bookkeeping in Local Storage
The local environment SHALL carry no sync residue: sync-scoped localStorage keys SHALL be removed once, sync-scoped IndexedDB databases SHALL be deleted once, the settings blob SHALL NOT contain `sync.yjs` or `sync.autoDownloadMode`, and the database SHALL NOT contain sync bookkeeping tables (`sync_config`, `sync_queue`, `sync_device_id`, `sync_tombstones`, `sync_outbox`, `sync_inbox`, `sync_applied_operations`, `sync_checkpoints`, `sync_dead_letters`, `sync_projection_hashes`, `sync_migration_state`, `sync_cutover_state`, `sync_cutover_domain_progress`).

#### Scenario: Upgrade from a syncing install
- **WHEN** a user upgrades from a build that previously used real-time sync
- **THEN** on first boot the sync IndexedDB databases and localStorage keys are deleted, the sync tables are dropped, and all locally authored data remains intact

### Requirement: No Sync User Interface
No sync configuration, status, QR-join, migration, or file-mirror UI SHALL exist in settings, dashboards, viewers, or mobile pages.

#### Scenario: Settings on desktop and mobile
- **WHEN** the user opens settings on either platform
- **THEN** no real-time sync tab, toggle, room, or diagnostics surface is offered

### Requirement: Authentication Continues to Function
The auth client SHALL continue to support login, registration, session retrieval, and logout against the API server, and consumers (login modal, user profile panel, review store) SHALL behave as before the removal.

#### Scenario: Login and profile
- **WHEN** the user logs in and opens their profile
- **THEN** authentication and profile retrieval work identically to the pre-removal behavior

### Requirement: Adjacent Features Are Unaffected
Cloud backup (provider OAuth, manual sync, conflict resolution), the browser-extension pairing server, and the Express API server (auth routes, extension offline queue) SHALL continue to function unchanged.

#### Scenario: Cloud backup after removal
- **WHEN** the user connects a cloud storage provider and runs a manual backup sync
- **THEN** the backup completes using the cloud path with no dependency on any real-time sync module

#### Scenario: Browser extension pairing after removal
- **WHEN** the browser extension pushes a page or extract to the local pairing server
- **THEN** the item is ingested exactly as before the removal
