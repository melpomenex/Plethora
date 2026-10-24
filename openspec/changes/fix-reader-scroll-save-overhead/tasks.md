## 1. Capture the baseline and affected contracts

- [ ] 1.1 Capture the current AppImage identity and controlled three-run 60-second scroll baseline for plain/Assistant-hidden and paper/Assistant-visible conditions; verify `verification.md` records frame timings, long tasks, save counts/latency, journal bytes, memory, and environment without committing user content.
- [ ] 1.2 Inventory reader persistence commands, lifecycle handlers, browser adapters, and PDF/EPUB/video/audio consumers; verify a source-anchored caller/compatibility table identifies the single save owner and full-document-return consumers.
- [ ] 1.3 Create deterministic small and multi-megabyte article fixtures and baseline behavioral tests that expose duplicate saves, oversized payloads, stale final samples, and scroll-triggered context preparation; verify the tests fail for the intended current behavior.

## 2. Make compact position sync safe

- [ ] 2.1 Extend the compact position payload with explicit position-field ownership and complete resume fields while preserving the previous compact decoder's readable shape; verify serialization tests exclude content/metadata, respect the 4 KiB fixture budget, and exercise the previous decoder.
- [ ] 2.2 Route compact and legacy compact records through alias-aware, tombstone-safe position-field HLC arbitration; verify stale/duplicate positions and concurrent content edits converge in both delivery orders without changing unrelated field clocks.
- [ ] 2.3 Preserve compact updates arriving before document creation through durable deferred/replay behavior; verify restart, later full-record materialization, and duplicate delivery retain the newest position without suppressing creation.
- [ ] 2.4 Cover local-only privacy, legacy full v1/v2 records, mixed-version limitations, and concurrent delete behavior; verify focused sync tests pass and compatibility limits are documented in `verification.md`.

## 3. Consolidate backend persistence

- [ ] 3.1 Add the bounded position request/acknowledgement contract and atomic update of unified and legacy fields with one compact journal record; verify transaction rollback, validation, unchanged-position handling, and the 1 KiB response fixture budget in focused Rust tests.
- [ ] 3.2 Remove full article reads/serialization from the new position operation and preserve compatibility for unrelated existing command consumers; verify large-content/metadata fixtures produce identical position payload sizes and exactly one journal entry per saved sample.
- [ ] 3.3 Implement equivalent browser-mode position behavior and migrate applicable shared helpers without changing other consumers' response contracts; verify adapter and API contract tests for both runtime modes.

## 4. Bound frontend scroll persistence

- [ ] 4.1 Introduce the document-scoped latest-sample coordinator with one in-flight request, one replaceable pending sample, a two-second periodic limit, and a 250 ms quiet-period flush; verify fake-timer tests cover continuous input, slow requests, no-ops, and newest-position ordering.
- [ ] 4.2 Migrate article readers from the dual legacy/unified save calls to the consolidated operation; verify standard Reader and Queue Scroll each journal one record per saved sample and restoration events schedule no saves.
- [ ] 4.3 Consolidate document/tab/queue/visibility/close flushes and preserve local checkpoints plus bounded failure recovery; verify switching A to B during an in-flight save never writes A's locator to B and duplicate cleanup is idempotent.
- [ ] 4.4 Narrow position subscriptions and stabilize callback identity so position-only updates do not invalidate unrelated reader/queue/Assistant trees; verify render-count tests and unchanged reader selection/highlight behavior.
- [ ] 4.5 Exercise shared PDF, EPUB, video/audio, inactive-tab, and browser-mode resume paths; verify representative integration tests preserve locator precision, lifecycle durability, and non-reader command contracts.

## 5. Remove duplicate eager Assistant work

- [ ] 5.1 Replace wrapper/Queue Scroll eager context pipelines with one active-source resolver invoked for prompts or explicit previews; verify a hidden-Assistant 60-second scroll simulation triggers zero full-source encodes solely from scrolling.
- [ ] 5.2 Add bounded reuse of source tokenization keyed by source revision and actual encoding, releasing stale buffers on replacement/unmount; verify repeated requests reuse work and source/model/encoding changes invalidate the correct entries.
- [ ] 5.3 Resolve fresh context from the current locator and selection, discarding stale asynchronous results; verify immediate-after-scroll prompts, document switches, selection precedence, citations, coverage indicators, provider budgets, and PDF/video context contracts.

## 6. Validate correctness and packaged responsiveness

- [ ] 6.1 Run the focused frontend/Rust persistence, lifecycle, context, and convergence suites plus applicable lint/type/format checks; verify `verification.md` lists exact commands, results, failures, and any unverified cases.
- [ ] 6.2 Add only meaningful seeded computation benchmarks for new size-sensitive helpers where appropriate and run `npm run bench:check` plus relevant `npm run test:scripts` checks; verify no unexplained performance/bundle baseline changes and record intentional changes with rationale.
- [ ] 6.3 Run `openspec validate fix-reader-scroll-save-overhead --strict` and the repository's applicable code quality/change checks; verify clean change-specific results or document unresolved findings without marking them passed.
- [ ] 6.4 Build a separate Linux AppImage with recorded source revision/hash and repeat the baseline workload; verify three runs per condition meet the frame/long-task, save-cadence, and payload budgets in the design without replacing the installed artifact.
- [ ] 6.5 Run a 15-minute reading/navigation soak including resume and Assistant prompts; verify memory after warmup, position accuracy, and responsiveness are recorded, and investigate remaining frame-budget failures before marking the scrolling issue verified.
- [ ] 6.6 Document old outbox backlog separately from newly generated compact records and assess safe recovery follow-up; verify no pending history is deleted and no automatic live-database vacuum or destructive migration is introduced.
