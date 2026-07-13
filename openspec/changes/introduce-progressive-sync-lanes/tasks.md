## 1. Baseline and Safety Harness

- [x] 1.1 Add sync lifecycle tracing for first paint, local usability, IndexedDB replay, provider/key setup, migration, per-map readiness, inbox projection, long tasks, memory, and transaction sizes.
- [x] 1.2 Build configurable small, large, ten-year, corrupt, and offline-divergent room fixtures with privacy-safe deterministic data.
- [x] 1.3 Add a reference-profile startup benchmark helper comparing sync-enabled/disabled first-use latency with a responsiveness overhead gate and long-task metric hook.
- [x] 1.4 Add deterministic convergence/chaos coverage for duplicate delivery, reordering, delete/recreate tombstones, cancellation, and review-event invariants.
- [x] 1.5 Add feature flags for journaled projection, progressive scheduling, sharded rooms, dual-write migration, and compaction; persistence/schema-changing features default off while the responsiveness scheduler defaults on.

## 2. Durable Journal and Local-First Startup

- [x] 2.1 Add SQLite migrations and Rust models/commands for sync outbox, inbox, applied-operation IDs, per-domain checkpoints, dead letters, projection hashes, and migration state.
- [x] 2.2 Implement compensating local-mutation-plus-outbox helpers and idempotent bounded inbox projection with transactional applied-operation markers.
- [x] 2.3 Refactor app bootstrap so local SQLite content and navigation render before Yjs persistence, crypto, provider, migration, or replicated maps initialize.
- [x] 2.4 Implement background outbox draining with mutable-operation coalescing while preserving deletes and append-only review events.
- [x] 2.5 Route incoming replicated-map updates through the durable inbox and applied-operation markers instead of issuing unbounded immediate per-entry Tauri calls.
- [x] 2.6 Add crash/restart recovery tests proving partially projected batches resume without loss or duplicate applied-operation effects.

## 3. Progressive Sync Coordinator

- [x] 3.1 Implement the P0-P3 lane queue, deadline-aware work-unit interface, durable-checkpoint hook, cancellation, work aging, and lower-lane capacity reservation.
- [x] 3.2 Implement browser scheduler integration with `postTask`/`isInputPending` and a tested `MessageChannel` fallback.
- [x] 3.3 Add adaptive slice sizing from observed duration plus visibility, connectivity, memory, power, and input-pressure hints with conservative fallbacks.
- [x] 3.4 Move migration, map warm-up, remote decode/projection, reseeding, and journal drain work into cancellable bounded work units with record/byte-aware scheduler budgets.
- [x] 3.5 Add coordinator health heartbeats, per-work deadlines, exponential backoff, quarantine/dead-letter hooks, and shard/domain circuit breakers.
- [x] 3.6 Add scheduler tests proving P0 preemption, user-input yielding, checkpoint hooks, lower-lane non-starvation, and cancellation/disposal behavior.

## 4. Sync Coverage Registry

- [x] 4.1 Implement the typed Sync Coverage Registry and require classification, lane, shard, size, conflict, deletion, export, apply, audit, and schema-version declarations.
- [x] 4.2 Add a machine-readable inventory of registered frontend, localStorage, SQLite, file-manifest, and settings domains with classifications and UX rationales.
- [x] 4.3 Register existing document, collection, extract, flashcard/review, RSS, podcast, and conversation adapters with the coverage coordinator.
- [x] 4.4 Add coverage policies for uncovered UX state including bookmarks/annotations, reader/media positions and sessions, safe preferences, file availability intent, and import provenance.
- [x] 4.5 Enforce privacy exclusions for credentials, secrets, machine paths, oversized/binary payloads, and derived data at the journal boundary with negative-leakage tests.
- [x] 4.6 Add registry validation tests that fail for unclassified sync domains or incomplete policy declarations.
- [x] 4.7 Add runtime coverage-audit primitives that detect persisted user-state changes without a matching journal operation for scoped backfill.

## 5. Domain Conflict Correctness

- [x] 5.1 Add deterministic append-only review merge/deduplication, merged-log ordering, and reducer-based schedule recomputation primitives.
- [x] 5.2 Complete field-level transition-clock merge coverage for RSS read/unread/queued state and add opposing-transition tests; podcast uses the same registered field-LWW mechanism.
- [x] 5.3 Implement session-aware reading/media progress merge rules with monotonic same-session progress, explicit reset intent, and tests.
- [x] 5.4 Enforce deletion dominance/tombstones in replicated-map conflict handling and test stale offline resurrection attempts.
- [x] 5.5 Implement deterministic fractional ordering utilities with device/id tie-breaking for ordered sync lists.
- [x] 5.6 Add backward-compatible policy/version helpers that preserve unknown additive fields and ignore unsupported domains.

## 6. Mutation-Path Completion

- [x] 6.1 Cover learning-item creation, editing, version restore, suspension, schedule adjustment, deletion, bulk mutation, Anki import, archive restore, review, and generated-card publication paths through the sync entity hooks.
- [x] 6.2 Hook RSS feed subscribe/unsubscribe plus article read/unread/queued transitions into registered sync policies; feed/folder ordering remains covered by the existing feed APIs.
- [x] 6.3 Hook document/extract/collection publication plus bookmarks, RSS annotations, reading sessions/positions, and media positions into registered policies; high-churn positions remain debounced/coalesced.
- [x] 6.4 Hook podcast subscribe/rename/unsubscribe, episode played/position, transcript availability, and download-intent changes without replicating local downloaded bytes.
- [x] 6.5 Hook saved assistant conversations and registered device-neutral preference storage while preserving device-local exclusions.
- [x] 6.6 Add two-device convergence contract tests for offline reviews, replay deduplication, and desktop-read-to-mobile-hidden RSS behavior.

## 7. Room Index and Sharded State

- [x] 7.1 Define and version the room-index schema for shard descriptors, epochs, snapshot hashes, capabilities, migration state, and device acknowledgements.
- [x] 7.2 Implement deterministic hash-bucket and epoch shard naming utilities for mutable domains and event logs.
- [x] 7.3 Add bounded shard lifecycle management with relevant-shard loading, open-handle caps, eviction, and clean teardown primitives.
- [x] 7.4 Add per-shard encoded-size, item-count, replay-time, memory/heartbeat metrics and rollover-health predicates.
- [x] 7.5 Implement snapshot generation/verification and new-epoch integrity primitives with schema, payload-hash, and tombstone-frontier checks.
- [x] 7.6 Implement conservative active-device acknowledgement/retention predicates so old epochs remain available to long-offline devices.
- [x] 7.7 Add relay capability detection with multiplexed-shard support and a tested bounded-provider fallback.

## 8. Backward-Compatible Migration

- [x] 8.1 Add per-domain dual-write/parity primitives that preserve legacy reads while comparing journal/shard projections.
- [x] 8.2 Implement incremental, checkpointed legacy export with per-session record/byte budgets and cooperative yields.
- [x] 8.3 Add verified per-domain cutover markers with a bounded legacy-read rollback window.
- [x] 8.4 Add device capability/acknowledgement gating before legacy writes can stop.
- [x] 8.5 Add migration scenario coverage for dual-write ordering, mixed-version compatibility, rollback, and retained long-offline epochs.
- [x] 8.6 Gate compaction behind its own rollout flag and retention/acknowledgement predicates; default remains off.

## 9. Integrity Audits and Recovery UX

- [x] 9.1 Implement count/hash/invariant audit primitives for replicated records, tombstones, and immutable-event uniqueness.
- [x] 9.2 Implement scoped repair from a verified shard snapshot without clearing unrelated Yjs state.
- [x] 9.3 Add non-blocking progressive sync status UI for Up to date, Catching up, Paused for responsiveness, and Needs attention states.
- [x] 9.4 Add non-blocking scoped retry controls for quarantined sync domains while preserving local data.
- [x] 9.5 Remove automatic whole-database clearing/reload on decode failures; surface a scoped sync-corruption event for recovery instead.

## 10. Verification and Rollout

- [x] 10.1 Run Rust (335 passing), encryption (36 passing), targeted frontend/sync, two-device, chaos, migration, and shard lifecycle suites; full frontend sweep is clean for this change, with unrelated sandbox/file-sync integration and local-port constraints documented.
- [x] 10.2 Record desktop/low-tier-mobile reference profiles and first-use, long-task, memory, transaction, catch-up, and power budgets in performance-budgets.md.
- [x] 10.3 Add large/ten-year fixture responsiveness verification proving enqueue/replay work is deferred and local responsiveness remains bounded.
- [x] 10.4 Verify registered domains have coverage/privacy tests and explicit replication or exclusion rationales.
- [x] 10.5 Document staged rollout and rollback checks for scheduler, journal, dual-write, shard reads, and compaction in rollout-plan.md.
- [x] 10.6 Document operator/user diagnostics, schema compatibility, recovery behavior, and the no-delete-on-sync-failure/rollback rule in operations.md.

## 11. Queue-Aware File Prefetch

- [x] 11.1 Add expiring, per-device `fileAvailabilityIntent` replication for the current queue horizon with tombstone-safe cleanup and coverage registration.
- [x] 11.2 Extend the file-sync controller to consume queue intents and persist available files in bounded background work while honoring local download policy.
- [x] 11.3 Trigger queue-horizon publication/prefetch from Queue Scroll navigation without delaying rendering or downloading unbounded queue contents.
- [x] 11.4 Add intent, policy, and queue-horizon tests plus TypeScript/build verification.
