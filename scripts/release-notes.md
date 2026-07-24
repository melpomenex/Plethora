### Fixed & Improved

- **Bounded sync startup work** — Sync boot now uses cooperative scheduling, ordered concurrency, and explicit byte budgets so background reconciliation remains responsive.
- **Sync diagnostics** — Phase duration, record, byte, and outcome telemetry is available in Settings and mirrored to the native desktop log.
- **Safer file-transfer caching** — Lazy disk-backed loaders and a byte-capped LRU preserve peer seeding while keeping resident file data bounded.
- **More stable queue virtualization** — Keyed height caches, bounded measurement passes, and prefix-sum offsets improve large queue scrolling and reordering.
- **Startup hygiene and database warnings** — Orphaned transcription temporary files are swept on launch, and preserved database conflict artifacts produce a dismissible warning.
- **Expanded regression coverage** — File-transfer, scheduler, sync boot, and virtual-list tests cover the new bounded-runtime paths.
