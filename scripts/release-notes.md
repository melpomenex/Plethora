### Added

- **Reader extraction with manual occlusion & richer mentions** — a new reader pass extracts cleaner content, adds manual occlusion support, produces richer `#` section mentions, and surfaces explicit browser-side failure states instead of failing silently.
- **Loopback web proxy for the in-app browser** — web pages now load through a loopback proxy with direct selection extraction, so paywalled/rewritten and chunked pages capture reliably.
- **Queue multi-select & bulk actions** — select multiple queue items for bulk actions, with stable order preserved on reactivation and improved list performance.
- **Scroll Mode follows the Queue List's order** — Scroll Mode now tracks the Queue List's exact ordering rather than an independent one.

### Fixed & Improved

- **`#` mentions delivered placeholder bodies** — the assistant now delivers the real chapter body for `#` mentions and rebuilds the section tree on retry so mentions resolve on the first send.
- **LLM provider persistence** — provider selection is now centralized, so it survives restarts consistently instead of drifting between views.
- **Chunked upstream pages failed to render** — hop-by-hop headers are now stripped in the browser proxy, so chunked upstream responses render correctly.
- **Queue ignored the flashcard percentage and Item Types toggles** — both are now honored, so the queue composition matches the configured filters.
- **Queue froze and jumped to #1 on session exit** — session teardown no longer stalls the queue or resets its position.
- **i18n gaps and placeholder mismatches** — backfilled missing translations across the queue and sync surfaces and fixed placeholder mismatches; the handbook documents queue ordering and backfills its translations.
- **Sync startup/runtime lag** — real-time Yjs sync is hard-disabled to eliminate the boot and runtime stalls it caused.
- **General stability and performance** — assorted hardening across sync, the queue, and the browser pipeline.
- **Firefox extension install path** — the signed browser-sync XPI is now hosted on GitHub Releases and the install links point at the working download URL.
