## Context

The app already delays Yjs/file sync until after the first paint, and the native backend gates ordinary commands behind database migrations. Those safeguards do not fully protect local startup:

- `src/main.tsx` starts `loadCollections()` during module evaluation.
- `MainLayout` independently starts `loadDocuments()` while the collection request may still be resolving.
- The default Dashboard and Queue tabs are both mounted even when Queue is hidden, so their effects can issue dashboard, progress, queue, and stats reads during the same boot window.
- The document store currently loads every summary row for a collection, and queue loaders can load the complete queue. The summary query avoids document bodies but still parses and transfers many per-row fields, tags, and possible cover data.
- The first frontend telemetry frame ends at the first animation frame, before the first useful database result is available, so it cannot distinguish a painted shell from a usable app.

The Boox Palma 2 makes the cost visible because WebView JavaScript, JSON IPC, SQLite row mapping, and React/Zustand updates have less CPU and memory headroom than desktop. The design must preserve local data correctness, existing full-detail document reads, and the current safe migration/corruption behavior.

## Goals / Non-Goals

**Goals:**

- Make the first local collection and visible-surface data load coordinated and idempotent.
- Keep the initial response bounded in row count, fields, and serialized bytes.
- Prevent hidden tabs and background enrichment from competing with the first interactive screen.
- Preserve collection scoping, full document detail access, and safe database readiness semantics.
- Produce actionable timing, row-count, and payload-size measurements for desktop and low-tier Android regression testing.

**Non-Goals:**

- Replacing SQLite, SQLx, Zustand, Tauri IPC, or the existing sync protocol.
- Moving migrations after backend readiness or allowing reads against an unmigrated database.
- Removing full document content, cover resolution, analytics, or background sync; these are only moved out of the critical path.
- Designing a general-purpose server cache or changing cross-device conflict semantics.

## Decisions

### 1. Use a bounded startup snapshot as the local bootstrap contract

Add a native/browser-compatible startup data command and typed frontend wrapper. The command returns the collection list and active collection id plus bounded data needed to make the shell useful:

- a first page of document summaries and its `total`/`hasMore` metadata;
- a bounded queue preview and its `total`/`hasMore` metadata when the restored/visible surface needs it;
- a small continue-reading/progress preview and due-count summary.

The initial DTO is deliberately smaller than `Document`: it contains identity, title, file type, collection, progress/scheduling fields, counts, dates, and UI flags, but no full content, embedding, raw metadata, or inline cover bytes. Existing `get_document(id)` remains the path for full content. Cover resolution and other enrichment run after local readiness or on demand.

The backend resolves the active collection once, then runs the bounded collection-scoped reads in parallel against the already-initialized pool. Queries use explicit projections, `LIMIT`/cursor or offset metadata, and verified indexes. This reduces IPC round trips and prevents a large library or queue from making the first response unbounded.

Alternative rejected: simply parallelizing the existing independent store calls. That would reduce wall-clock time in some cases but would retain the default-collection race, duplicate work from mounted tabs, and unbounded result sizes.

### 2. Coordinate frontend hydration behind one idempotent startup coordinator

Add a small coordinator/store responsible for the startup lifecycle and an in-flight promise keyed by the active collection and startup epoch. `MainLayout` starts it after tabs/session restoration has supplied the visible surface. Collection loading moves out of module evaluation; document and queue stores consume the snapshot instead of starting competing boot reads.

The coordinator publishes `idle`, `loading`, `ready`, and `error` state plus per-domain completion. It applies the snapshot to Zustand stores in one logical hydration step, so filters and derived selectors do not recompute for every independent response. Repeated callers from Dashboard, Queue, Documents, and Continue Reading share the same work. A collection switch creates a new key and cannot reuse data from the previous collection.

Alternative rejected: adding only a global boolean such as `hasLoaded`. A boolean cannot represent a failed/partial load, collection changes, saved-session surfaces, or concurrent callers safely.

### 3. Load only the visible surface eagerly; paginate and hydrate the rest

Inactive mounted tabs must not issue their initial database reads. Dashboard loads its small startup preview and non-critical analytics after the snapshot; Queue loads the bounded queue page when it becomes active; Documents loads the first library page when active and requests additional pages as the user scrolls or explicitly refreshes. Continue Reading consumes the startup progress preview and only refetches when it needs a larger result.

Store actions retain explicit refresh paths for mutations and errors. Background page filling, cover resolution, sync registration, and search/index enrichment are scheduled after local readiness using the existing idle/deferred mechanisms. They must not block input or replace the already-visible snapshot with an empty intermediate state.

### 4. Keep database safety gates, but make the critical native path bounded and observable

The existing `wait_for_backend_ready` gate remains mandatory. Database open, integrity checking, and migrations complete before normal reads are allowed; corruption quarantine and fresh-database recovery semantics remain unchanged. Non-essential cloud, keychain, demo-content, browser-sync, and Yjs work remains outside that gate.

Instrument the native setup phases and startup command separately. Use a platform-aware, bounded SQLite pool configuration so Android does not reserve desktop-sized concurrency, and verify query plans before adding or changing indexes. Add composite indexes only where the startup query plans show the current single-column indexes are insufficient, especially for collection-scoped date ordering and due-item selection.

Alternative rejected: marking the backend ready before migrations or integrity validation finish. It could make the first request appear faster while allowing commands to observe incomplete schema state and would weaken the recovery guarantee.

### 5. Make performance a release-tested contract

Extend the current sync telemetry with local-startup phases: backend-ready, startup-command, collections-ready, first-document-data, first-queue-data, and background-hydration. Record duration, item counts, serialized bytes, query/page metadata, errors, and long-task observations without retaining content.

The reference fixture will model a large local library (for example, 1,000 documents and 5,000 learning items) with sync disabled. Acceptance targets are p95 first local data within 1,000 ms on the Boox Palma 2 reference profile and within 500 ms on a desktop reference profile, with a default startup response capped at 50 document summaries, 50 queue items, and 256 KiB serialized payload. The benchmark must also verify that the default boot makes one coordinated startup read and that hidden tabs do not add startup reads.

## Risks / Trade-offs

- [Users with a very large library initially see only the first page] → Preserve total/hasMore metadata, virtualized/paginated loading, and explicit refresh; do not silently discard records.
- [A summary DTO can omit data a surface currently assumes is present] → Add contract tests for every startup consumer, keep full-detail APIs unchanged, and defer only fields proven unnecessary for the first render.
- [A single snapshot command couples several domains] → Keep domain sections independently optional/typed, apply partial results without clearing successful sections, and retain per-domain retry paths.
- [Background hydration can compete with user input on low-tier devices] → Schedule bounded idle slices, yield on input pressure, cap concurrency, and pause background work while the app is interacting.
- [Database indexes and mobile pool limits can help one workload but hurt another] → Use `EXPLAIN QUERY PLAN`, fixture benchmarks, and platform-specific comparison before accepting the migration/configuration.
- [Timing changes may expose slow migrations or integrity checks rather than fix them] → Report native setup separately from frontend data loading, preserve safety gates, and make any future migration optimization a separately reviewable change.

## Migration Plan

1. Add telemetry, startup DTOs, repository query helpers, and fixture tests without changing existing store behavior.
2. Add the coordinated startup command and coordinator behind a feature flag or fallback path; compare snapshot results against existing per-store loads in development/test builds.
3. Switch the default shell and visible tabs to the coordinator, disable hidden-tab boot effects, and enable bounded pagination/background hydration.
4. Validate desktop and Boox Palma 2 profiles, query plans, empty/legacy/corrupt database behavior, and collection switching.
5. Keep the legacy commands and per-store retry paths for at least one release so a failed snapshot can fall back without data loss. Remove only redundant boot calls after telemetry confirms parity.

Rollback disables the coordinator consumer and returns to the existing document/queue commands while retaining telemetry. No database rows are removed by this change; any index migration is additive and safe to leave in place.

## Open Questions

- Should the default page size remain 50 on all devices, or should the coordinator choose a smaller bound from a device-memory/viewport hint after the first benchmark pass?
- Does the restored session need queue data in the first snapshot when its active tab is not Queue, or is lazy activation sufficient?
- Which cover formats are cheap enough to include as a URL reference in the first page, versus always resolving after first local data?
