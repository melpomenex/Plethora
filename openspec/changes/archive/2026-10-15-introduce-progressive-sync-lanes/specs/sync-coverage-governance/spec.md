## ADDED Requirements

### Requirement: Explicit sync policy registry
Every persisted state domain SHALL declare a machine-readable policy identifying its data classification, priority lane, shard policy, record limit, conflict semantics, deletion semantics, local export, remote projection, and integrity audit behavior.

#### Scenario: New persisted domain is added
- **WHEN** a developer adds a new persisted user-facing domain without a sync or explicit exclusion policy
- **THEN** automated validation fails and identifies the unclassified domain

#### Scenario: Domain is intentionally device-local
- **WHEN** a persisted domain is classified as device-local or derived
- **THEN** its policy documents the UX rationale and tests verify that it is not emitted to shared state

### Requirement: UX-meaningful state coverage
The system SHALL replicate state required for a coherent cross-device experience, including learning items, immutable reviews, collections, document metadata, extracts/highlights, bookmarks/annotations, reading and playback progress, RSS subscriptions and read/unread/queued transitions, podcast state, conversations, safe preferences, and file availability intent.

#### Scenario: Article is read on desktop
- **WHEN** a user reads an RSS article on desktop and later opens the phone
- **THEN** the phone reconciles the article as read and does not present it as unseen content unless the user explicitly marked it unread later

#### Scenario: Flashcard is reviewed offline on mobile
- **WHEN** a user reviews a learning item offline on mobile and later reconnects
- **THEN** the immutable review and resulting schedule converge on other devices without duplication or loss

#### Scenario: Reading continues on another device
- **WHEN** a user stops reading or listening on one device and opens the same source on another
- **THEN** the second device receives the applicable progress, bookmark, and annotation state according to session-aware conflict rules

### Requirement: Privacy and payload exclusions
The system MUST NOT replicate credentials, API tokens, encryption secrets, machine-specific paths, window geometry, hardware choices, transient UI state, disposable caches, logs, embeddings, search indexes, or downloaded source bytes through the state CRDT.

#### Scenario: File is imported from a local path
- **WHEN** a file is imported on one device
- **THEN** shared state contains safe metadata and availability intent but not the originating machine's path or the file bytes in the CRDT

#### Scenario: API credential changes
- **WHEN** a user saves an API credential
- **THEN** the credential remains in approved secure local storage and no sync operation contains its value

### Requirement: Intent and source synchronization for derived experiences
For state that can be safely reproduced, the system SHALL synchronize the minimum source metadata, explicit saved output, or user intent needed to recreate the experience instead of synchronizing bulky derivatives.

#### Scenario: Search index is absent on a new device
- **WHEN** a new device receives synced documents and extracts
- **THEN** it rebuilds its search index locally without downloading another device's index

#### Scenario: Podcast download intent is enabled
- **WHEN** a user requests an episode download on one device
- **THEN** other devices receive the intent and independently honor it according to their local network and storage policy

### Requirement: Complete mutation-path publication
Every create, update, delete, restore, bulk edit, import, and migration path for a replicated domain SHALL enqueue the corresponding sync operation or explicitly prove that another covered path does so.

#### Scenario: Bulk flashcard schedule change completes
- **WHEN** a bulk postpone, advance, suspend, restore, or import operation changes learning items
- **THEN** all affected items are discoverably enqueued without requiring a full startup reseed

#### Scenario: Feed is unsubscribed
- **WHEN** a user unsubscribes from an RSS or podcast feed
- **THEN** a durable tombstone is published so an offline device cannot later resurrect the subscription from stale state

### Requirement: Domain-specific deterministic conflicts
Each replicated policy SHALL use deterministic conflict semantics appropriate to the user action rather than applying generic row-level last-writer-wins to all state.

#### Scenario: Concurrent RSS read and queue changes occur
- **WHEN** separate devices concurrently change an article's read state and queued state
- **THEN** each field resolves using its own transition clock and neither independent action is discarded

#### Scenario: Concurrent collection order changes occur
- **WHEN** devices reorder collection entries offline and reconnect
- **THEN** all entries remain present in a deterministic order with stable tie breaking

#### Scenario: Review projections disagree
- **WHEN** devices merge immutable reviews but their stored card schedules disagree
- **THEN** the schedule is deterministically recomputed from the ordered review log

### Requirement: Projection and coverage audits
The system SHALL detect missing mutation publication, local/replicated projection drift, duplicate immutable events, invalid tombstones, and shard/index inconsistencies using privacy-preserving counts, hashes, and invariants.

#### Scenario: Local projection misses an operation
- **WHEN** an audit finds that a local bucket hash differs from the verified replicated snapshot
- **THEN** the affected bucket is scheduled for scoped reconciliation without blocking app use

#### Scenario: Mutation bypasses the outbox
- **WHEN** runtime auditing observes a replicated table change with no matching operation or acknowledged remote origin
- **THEN** diagnostics identify the domain and mutation path and the system schedules a safe backfill

### Requirement: Device-neutral settings with local overrides
Only settings that affect a user's cross-device product experience SHALL sync as defaults, while platform, hardware, privacy, and presentation settings declared device-local SHALL remain local overrides.

#### Scenario: Review preference changes
- **WHEN** a user changes a registered device-neutral learning preference
- **THEN** the preference becomes the default on paired devices unless a policy-defined local override applies

#### Scenario: Window geometry changes
- **WHEN** a desktop window is resized or moved
- **THEN** the geometry remains local and does not alter phone or other desktop layouts

### Requirement: Queue-aware file availability intent
Queued document files SHALL be represented as bounded, expiring download intent rather than requiring a user to open each document and press Download. Intent SHALL be scoped to the requesting device's queue horizon, synchronized without file bytes, and honored on receiving devices according to their local network/storage policy.

#### Scenario: A document enters the queue horizon
- **WHEN** a document with a sync file identifier is among the next queued items
- **THEN** the device publishes an expiring queue-prefetch intent and schedules a bounded background fetch without blocking queue rendering

#### Scenario: Queue intent reaches another device
- **WHEN** a paired device receives an active queue-prefetch intent and the source file is available
- **THEN** it downloads and persists the file in the background so the document is ready when it reaches the front of that device's queue

#### Scenario: Queue intent leaves the horizon
- **WHEN** a document is no longer in the local queue horizon
- **THEN** only that device's intent is tombstoned or allowed to expire, without deleting a local copy or cancelling another device's intent

#### Scenario: User selected manual file downloads
- **WHEN** a receiving device is configured for manual file downloads
- **THEN** queue intent remains recorded for later policy changes but does not start a background transfer or override the user's local setting

### Requirement: Schema evolution and unknown-domain safety
Sync policies and records SHALL be versioned, and clients SHALL preserve but not destructively project unknown newer fields or domains.

#### Scenario: Older client receives a newer record
- **WHEN** a client encounters a supported domain record with unknown additive fields
- **THEN** it preserves those fields through replication while projecting only fields it understands

#### Scenario: Client encounters unknown domain shard
- **WHEN** the room index references a domain unsupported by that client
- **THEN** the client leaves the shard intact, reports compatibility status, and continues syncing supported domains
