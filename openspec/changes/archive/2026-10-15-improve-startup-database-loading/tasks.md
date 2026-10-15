## 1. Baseline and Startup Measurement

- [x] 1.1 Trace the current cold-start request graph for `main.tsx`, `MainLayout`, the default Dashboard/Queue tabs, collection loading, document loading, queue loading, and dashboard progress/stats; record the existing duplicate-call behavior without changing unrelated worktree edits.
- [x] 1.2 Extend startup telemetry with backend-ready, startup-command, collections-ready, first-document-data, first-queue-data, and background-hydration phases, including duration, outcome, row count, page metadata, and serialized byte count without retaining content.
- [x] 1.3 Add a deterministic large local-data fixture and a benchmark harness for approximately 1,000 documents and 5,000 learning items with sync disabled, empty-database coverage, and configurable desktop/Boox Palma 2 profiles.
- [x] 1.4 Add diagnostic request labels/counters so tests and benchmark output can prove that one coordinated startup load ran and hidden tabs did not add equivalent reads.

## 2. Native and Browser Startup Data Contract

- [x] 2.1 Define versioned Rust and TypeScript startup DTOs for collections/active collection, bounded document summaries, bounded queue preview, continue-reading preview, due counts, `total`, and `hasMore` metadata.
- [x] 2.2 Implement repository methods for explicit, collection-scoped, bounded document summary and queue/progress reads; avoid `SELECT *`, document bodies, embeddings, raw metadata, and inline cover bytes on the startup path.
- [x] 2.3 Use `EXPLAIN QUERY PLAN` against the benchmark fixture, add only the missing composite indexes needed for collection/date ordering and due-item selection, and cover index creation with migration tests.
- [x] 2.4 Implement the native `get_startup_snapshot` command so it resolves the active collection once and performs bounded domain reads without bypassing the existing backend-ready/migration gate.
- [x] 2.5 Implement the equivalent bounded startup command in the IndexedDB/browser backend so PWA behavior and test doubles share the same response shape and limits.
- [x] 2.6 Add typed frontend API wrappers and normalization for the startup command, including byte/item limits, partial domain results, and collection-scoped page cursors or offsets.
- [x] 2.7 Make SQLite pool concurrency platform-aware and bounded, using benchmark evidence to choose mobile and desktop values while preserving busy-timeout, WAL, and corruption-recovery behavior.

## 3. Coordinated Frontend Hydration

- [x] 3.1 Add a startup coordinator/store with `idle`, `loading`, `ready`, and `error` states, per-domain completion, and an in-flight promise keyed by startup epoch, active collection, and visible surface.
- [x] 3.2 Move module-evaluation collection loading out of `src/main.tsx` and sequence tab/session restoration with the coordinator so scoped reads use the resolved active collection.
- [x] 3.3 Apply a successful startup snapshot to collection, document, queue, and progress state in one logical hydration transaction, avoiding intermediate empty states and repeated filter recomputation.
- [x] 3.4 Invalidate startup keys and visible data safely on collection switch, retain explicit refresh behavior after mutations, and prevent late responses from an old collection overwriting the new collection.
- [x] 3.5 Add recoverable per-domain error and retry handling that preserves successful startup sections and does not retry indefinitely.

## 4. Visible-Surface Loading and Pagination

- [x] 4.1 Refactor `MainLayout` and the default Dashboard/Queue tab setup so only the active surface eagerly requests data; keep the hidden-tab mount behavior for state preservation without running hidden-tab boot effects.
- [x] 4.2 Update Dashboard and Continue Reading to consume the bounded startup/progress preview, deferring non-critical analytics and larger reads until after local data is ready.
- [x] 4.3 Update Queue and mobile queue views to consume a bounded queue preview/page, dedupe activation and refresh requests, and request additional items only for explicit user navigation or filter changes.
- [x] 4.4 Add paged document-store loading for the Documents surface, merge later pages without reloading the first page, and preserve search/filter/virtual-list behavior.
- [x] 4.5 Keep full document content/detail loading, cover resolution, file-sync registration, and background enrichment on demand or in deferred work after startup readiness.
- [x] 4.6 Update collection switching, imports, deletes, bulk operations, and sync-arrival refresh paths to invalidate or append to the new paged/coordinated stores without regressing existing optimistic behavior.

## 5. Safety, Background Work, and Compatibility

- [x] 5.1 Verify native setup still completes integrity handling and migrations before normal commands can query the database, and preserve quarantine/recovery notices for corrupt databases.
- [x] 5.2 Ensure Yjs, file sync, cloud/keychain loading, demo-content checks, search/index enrichment, and other non-critical startup work remain deferred and yield to user input on low-tier devices.
- [x] 5.3 Add compatibility handling for empty, legacy, partially migrated, and browser/IndexedDB databases, including a safe fallback to existing per-domain commands if the snapshot command is unavailable or fails.

## 6. Verification and Performance Gates

- [x] 6.1 Add Rust repository/command tests for collection scoping, explicit summary columns, page limits, `total`/`hasMore`, empty results, and startup ordering behind the backend-ready gate.
- [x] 6.2 Add frontend unit tests for coordinator promise sharing, active-collection sequencing, late-response cancellation, partial failure/retry, store hydration, and pagination merging.
- [x] 6.3 Add component tests proving hidden tabs do not load on mount, active Queue/Dashboard loads happen once, and the startup response never exposes full document content or inline cover bytes.
- [x] 6.4 Run the large-fixture benchmark on the desktop reference profile and Boox Palma 2, verify p95 first local data targets of 500 ms desktop and 1,000 ms Palma 2, and capture payload/long-task diagnostics.
- [x] 6.5 Run targeted frontend tests, Rust tests, type/build checks, and Android packaging checks; document any device-specific variance and confirm existing unrelated worktree changes remain untouched.
- [x] 6.6 Remove redundant legacy boot calls only after parity and benchmark evidence pass, then document the rollback/fallback switch and final startup budgets in the change artifacts.
