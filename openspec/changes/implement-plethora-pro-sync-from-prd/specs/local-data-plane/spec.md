## MODIFIED Requirements

### Requirement: No Remote Sync Connections
When Plethora Pro Sync is **disabled** (default for free users, or explicitly turned off), the application SHALL NOT establish connections to the Plethora sync service except auth/entitlement checks already used for account features. When Pro Sync is **enabled** and the user is entitled, the application SHALL use only the v2 delta sync endpoints (`/v1/sync/*`, `/v1/blobs/*`) — never Yjs, WebSocket CRDT relays, or legacy `/sync` plaintext routes.

#### Scenario: Boot with sync disabled
- **WHEN** the application starts with sync disabled or without Pro entitlement
- **THEN** no sync push/pull/blob network activity occurs

#### Scenario: Boot with Pro sync enabled
- **WHEN** the application starts with Pro sync enabled and valid entitlement
- **THEN** the background sync worker MAY connect to `/v1/sync/*` after idle initialization, not on the startup critical path

#### Scenario: Stale Yjs settings migrated
- **WHEN** persisted settings contain legacy `sync.yjs.enabled`
- **THEN** the setting is removed and no Yjs connection is attempted

### Requirement: Boot Without Sync Subsystem Initialization
Application startup SHALL NOT initialize Yjs, y-indexeddb, entity replicators, or legacy realtime sync. The v2 sync worker MAY register lazily after first paint. Startup MUST NOT block on sync pull, push, or initial upload.

#### Scenario: Cold start with sync enabled
- **WHEN** a user cold-starts with Pro sync enabled
- **THEN** startup completes without awaiting sync network I/O and without loading Yjs modules

### Requirement: Local SQLite Is the Sole Data Plane
All user-facing reads and writes SHALL target local SQLite via domain commands. When sync is enabled, domain write paths SHALL additionally journal to `sync_outbox` in the same transaction via explicit `mark_dirty` hooks — not via frontend state replication.

#### Scenario: Flashcard review with sync enabled
- **WHEN** the user completes a flashcard review with Pro sync enabled
- **THEN** the review is applied to SQLite, an outbox row is written atomically, and no synchronous network call occurs

#### Scenario: Document deletion with sync enabled
- **WHEN** the user deletes a document with sync enabled
- **THEN** the document is removed locally and a tombstone outbox entry is recorded

### Requirement: No Sync Bookkeeping in Local Storage
Legacy Yjs residue (sync-scoped IndexedDB, `sync.yjs` settings keys) SHALL remain removed. When Pro sync is enabled, the database SHALL contain v2 sync bookkeeping tables (`sync_outbox`, `sync_cursor`, `sync_clock`, `sync_meta`) and MUST NOT recreate removed Yjs tables or realtime sync queues.

#### Scenario: Upgrade from non-sync build
- **WHEN** a user upgrades to a Pro sync build from a sync-disabled build
- **THEN** v2 sync tables are created via migration, local user data remains intact, and no Yjs residue is reintroduced

### Requirement: No Sync User Interface
Legacy realtime sync UI (Yjs room, CRDT diagnostics, relay toggles) SHALL NOT return. Settings SHALL expose the Pro sync panel (`SyncSettingsPanel`) for entitled users: status, devices, manual sync, encryption/pairing — not realtime collaboration controls.

#### Scenario: Settings for entitled Pro user
- **WHEN** a Pro user opens Settings → Sync
- **THEN** v2 sync status and controls are available and no Yjs/CRDT UI appears

#### Scenario: Settings for free user
- **WHEN** a free user opens settings
- **THEN** no sync enablement that performs cloud synchronization is offered without Pro upgrade

### Requirement: Authentication Continues to Function
The auth client SHALL continue to support login, registration, session retrieval, and logout. Sync enrollment SHALL reuse account authentication and device registry without breaking existing login/profile flows.

#### Scenario: Login then enable sync
- **WHEN** the user logs in and enables Pro sync
- **THEN** authentication and profile retrieval behave as before and sync uses the same session token

### Requirement: Adjacent Features Are Unaffected
Cloud backup (provider OAuth/manual backup), browser-extension pairing, and non-sync API routes SHALL continue to function. Pro sync MUST NOT replace local backup/export.

#### Scenario: Local backup after sync enabled
- **WHEN** the user runs a local backup with sync enabled
- **THEN** backup completes independently of sync push/pull state
