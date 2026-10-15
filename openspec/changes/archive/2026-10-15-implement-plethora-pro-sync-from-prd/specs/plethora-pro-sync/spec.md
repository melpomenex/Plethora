## ADDED Requirements

### Requirement: Syncable mutations are journaled atomically in SQLite
Every mutation to a whitelisted syncable entity SHALL insert a corresponding row into `sync_outbox` within the same SQLite transaction as the domain write. If the domain transaction rolls back, no outbox row SHALL exist. If an outbox insert fails, the domain mutation SHALL NOT commit.

#### Scenario: Card review creates outbox entry
- **WHEN** the user completes a flashcard review while sync is enabled
- **THEN** the review is persisted locally and exactly one `sync_outbox` row with operation `append_event` exists for that review

#### Scenario: Failed local write does not journal
- **WHEN** a domain write fails validation before commit
- **THEN** no `sync_outbox` row is created for that attempted mutation

### Requirement: Local mutations never wait on network
Interactive user actions (review, edit card, change reading position, create extract, modify settings) SHALL complete after local SQLite commit only. Sync upload SHALL occur asynchronously in a background worker and MUST NOT block the UI thread or the domain command response.

#### Scenario: Review completes offline
- **WHEN** the device has no network connectivity and the user rates a card
- **THEN** the review succeeds immediately and the outbox retains the pending change

#### Scenario: Slow server does not slow rating
- **WHEN** the sync server responds slowly or times out
- **THEN** the user can continue reviewing without increased latency per review

### Requirement: Push and pull use bounded batches and monotonic cursors
The sync worker SHALL upload pending outbox batches via `POST /v1/sync/push` and download deltas via `GET /v1/sync/pull` using a persisted `last_server_cursor`. Each batch SHALL respect maximum record count (default 500) and maximum serialized payload size (default 5 MB). Pull responses SHALL be applied in pages without materializing the full remote account state in memory.

#### Scenario: Idempotent push retry
- **WHEN** the client uploads a change that was already accepted but the response was lost
- **THEN** the server treats the duplicate as already applied and the client marks the outbox row acknowledged without duplicating domain data

#### Scenario: Pull resumes after interruption
- **WHEN** a pull is interrupted mid-pagination
- **THEN** restarting sync continues from the last successfully applied server cursor

### Requirement: Review history is append-only across devices
Review events SHALL be modeled as immutable append-only records. Concurrent reviews from offline devices SHALL all be retained (deduplicated by deterministic event identity). The scheduler SHALL derive current scheduling state by deterministically replaying ordered review history and MUST NOT silently discard valid review events.

#### Scenario: Two offline reviews on different devices
- **WHEN** device A and device B each review the same card while offline and later sync
- **THEN** both review events exist exactly once locally on both devices after convergence

### Requirement: Deletes propagate via tombstones
Entity deletion SHALL produce a tombstone sync record with `deleted_at` and revision metadata. Offline devices SHALL learn of remote deletions through pull and MUST NOT resurrect deleted entities when applying later deltas.

#### Scenario: Remote delete reaches offline device
- **WHEN** a document is deleted on device A and device B was offline
- **THEN** after B syncs, the document is removed or marked deleted on B according to tombstone rules

### Requirement: Sync failures do not cause local data loss
Sync upload or download failures SHALL leave local domain data intact, retain pending outbox entries, and retry with exponential backoff and jitter. Permanent failures SHALL surface a user-actionable sync error without rolling back local mutations.

#### Scenario: Server outage during upload
- **WHEN** push fails with a server error
- **THEN** local reviews and edits remain saved and outbox rows stay pending for retry

### Requirement: Sync status is honestly reported in settings
The sync settings UI SHALL display enabled/disabled state, last successful sync time, pending outbox count, and current sync activity (syncing, offline, error, initial sync). The UI MUST NOT report success unless the worker confirmed acknowledgment or cursor advancement.

#### Scenario: Pending changes visible
- **WHEN** outbox rows are pending and the network is unavailable
- **THEN** settings show offline or error state with a non-zero pending count, not "up to date"

### Requirement: Pro entitlement is required for cloud sync
Cloud push, pull, and blob sync endpoints SHALL require an active Plethora Pro entitlement (`cloud_sync`). Clients without Pro SHALL continue operating locally with sync disabled and no sync network activity.

#### Scenario: Free user cannot upload
- **WHEN** a signed-in free-tier user attempts sync push
- **THEN** the server rejects the request with an entitlement error and local data remains intact

### Requirement: Sync engine initializes lazily and does not block startup
Application startup SHALL NOT wait for sync initialization, initial upload, or pull completion. The sync worker MAY schedule its first run after first paint / idle time.

#### Scenario: Cold start with sync enabled
- **WHEN** the app launches with sync enabled and a large pending outbox
- **THEN** time-to-interactive matches sync-disabled baseline within existing performance gates

### Requirement: Two devices converge without manual intervention
Under normal connectivity, two registered devices modifying disjoint or merge-compatible data SHALL converge to consistent local SQLite state within bounded time after edits, without user merge actions for LWW-compatible fields.

#### Scenario: Desktop to desktop card edit
- **WHEN** device A edits a card field and device B edits a different field on the same card while both are offline, then both sync
- **THEN** both devices contain the merged card with both field changes
