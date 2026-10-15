## ADDED Requirements

### Requirement: Local-first non-blocking startup
The application SHALL render a usable local interface without awaiting Yjs persistence replay, encryption-key provisioning, WebSocket connection, migration, remote reconciliation, or projection completion.

#### Scenario: Sync relay is unavailable at launch
- **WHEN** a user launches the app with sync enabled and the relay is unavailable
- **THEN** locally stored content and navigation become usable without waiting for a network timeout

#### Scenario: Large persisted CRDT exists
- **WHEN** the device has a large local Yjs history to replay
- **THEN** replay begins only after the first usable local interface is rendered and proceeds within scheduled work budgets

### Requirement: Budgeted cooperative sync execution
The sync runtime SHALL execute decode, merge, migration, encryption, audit, and local projection as cancellable bounded work units that yield to user input and rendering.

#### Scenario: User interacts during catch-up
- **WHEN** user input arrives while a lower-priority sync batch is executing
- **THEN** the runtime yields or cancels that batch at its next safe checkpoint and services the interaction without losing sync progress

#### Scenario: Work unit exceeds its deadline
- **WHEN** a sync work unit consumes more than its assigned deadline or record/byte budget
- **THEN** the runtime persists a checkpoint, yields, and resumes from that checkpoint in a later slice

### Requirement: Priority lanes
The sync runtime SHALL prioritize current UX-critical transitions over bulk library state and rebuildable derivatives, while preventing permanent starvation of lower-priority work.

#### Scenario: RSS read state and bulk metadata are pending
- **WHEN** an RSS read transition and a bulk document metadata migration are both pending
- **THEN** the read transition is reconciled first and the bulk work resumes in later idle slices

#### Scenario: Library catch-up remains pending
- **WHEN** lower-priority library work has repeatedly yielded to interactive work
- **THEN** the scheduler ages or reserves capacity for that work until it completes while the app remains responsive

### Requirement: Durable resumable replication journal
Local outgoing and incoming sync operations SHALL be durably checkpointed, idempotent, and recoverable across crashes, cancellation, duplicate delivery, and reconnects.

#### Scenario: App closes during remote projection
- **WHEN** the app closes after receiving a batch but before projecting the entire batch to SQLite
- **THEN** the next launch resumes from the last committed checkpoint without losing or double-applying operations

#### Scenario: Same review event is delivered twice
- **WHEN** an immutable review operation is received more than once
- **THEN** exactly one review event exists and the resulting learning schedule is unchanged by the duplicate

### Requirement: Bounded shard lifecycle
The sync runtime SHALL isolate payload state into bounded domain shards, load shards according to priority and relevance, and roll oversized or slow-replaying shards to verified snapshot epochs.

#### Scenario: Fresh device joins a mature room
- **WHEN** a fresh device joins a room with years of history
- **THEN** it loads the small room index and UX-critical shards before older bulk shards and does not need to replay superseded lifetime history

#### Scenario: Shard crosses rollover threshold
- **WHEN** a shard exceeds its configured size, item-count, or replay-time threshold
- **THEN** the system creates and verifies a snapshot, advances the shard epoch, and retains the prior epoch until safe retirement criteria are met

### Requirement: Safe compaction and offline-device recovery
The runtime MUST preserve deletes and offline-device convergence during snapshotting and compaction and MUST NOT retire required history solely based on local wall-clock age.

#### Scenario: Device reconnects after missing a compaction
- **WHEN** a long-offline device reconnects with operations based on a retained earlier epoch
- **THEN** its valid operations merge into the current state without resurrecting tombstoned entities

#### Scenario: Snapshot verification fails
- **WHEN** a compacted snapshot fails its hash, schema, or tombstone-frontier verification
- **THEN** the runtime rejects it, keeps the prior epoch, and quarantines only the affected shard

### Requirement: Fault isolation and degraded mode
The runtime SHALL keep the local app usable and isolate failures to the smallest affected persistence store, shard, or domain.

#### Scenario: One domain contains malformed data
- **WHEN** an RSS shard contains a malformed or oversized record
- **THEN** that record or shard is quarantined while learning-item and other sync lanes continue

#### Scenario: Repeated startup sync failure
- **WHEN** a sync component repeatedly exceeds deadlines or fails health checks
- **THEN** it enters backoff, reports a non-blocking needs-attention state, and does not clear unrelated local or replicated data

### Requirement: Adaptive resource behavior
The runtime SHALL reduce or suspend non-critical work in response to visibility, input, memory, connection, and power constraints when those signals are available.

#### Scenario: Mobile app is backgrounded
- **WHEN** the app moves to the background
- **THEN** non-critical sync and maintenance work pauses at safe checkpoints and resumes when foreground execution is available

#### Scenario: Resource hints are unavailable
- **WHEN** a platform does not expose memory, power, or connection hints
- **THEN** correctness is preserved using conservative default budgets

### Requirement: Sync performance release gates
The project SHALL maintain repeatable startup, catch-up, convergence, and corruption benchmarks with explicit reference profiles and SHALL fail release validation when the agreed responsiveness budgets regress.

#### Scenario: Large-room startup benchmark runs
- **WHEN** the benchmark launches a sync-enabled app against the large-room fixture
- **THEN** first usable UI regression, sync-attributable long tasks, peak memory, transaction size, and catch-up duration are measured against recorded thresholds

#### Scenario: Chaos convergence suite runs
- **WHEN** operations are randomly interleaved with offline periods, duplicate delivery, cancellation, crashes, and shard rollover
- **THEN** all devices converge to equivalent user state with no duplicate review events or lost tombstones

### Requirement: Honest non-blocking status and recovery
The application SHALL present concise sync progress/degraded status and scoped recovery actions without blocking ordinary use.

#### Scenario: Scheduler pauses for responsiveness
- **WHEN** catch-up is intentionally paused due to interactive load
- **THEN** the sync UI indicates that syncing is paused to keep the app responsive and automatically continues later

#### Scenario: User retries a quarantined shard
- **WHEN** the user chooses retry or rebuild for an affected shard
- **THEN** only that shard's local persistence is retried or rebuilt from a verified snapshot and local application data remains intact
