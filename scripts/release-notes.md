### Added

- **Delta-log sync transport (live, opt-out)** — the new zero-knowledge sync engine is now enabled by default (`VITE_SYNC_DELTA_LOG=true`). It drives each room through a cutover state machine (drain → seed → dual → verified → cutover → quiesced → retired), seeds the local library to the delta-log server, and pulls/converges across devices. Validated end-to-end on a real two-device room (mac + Android): 1401 rows pushed and converged, both devices at cursor head.
- **Boot-time cutover orchestrator** — `runCutoverOrchestrator` builds the delta-log config, registers the room (TOFU), starts the pull loop + WebSocket notifications + presence heartbeat, and advances the room one phase per boot up to `verified`. Triggered at boot and on room join/create.
- **Per-domain seed readers** — read every SQLite row for each synced domain carrying its existing HLC verbatim, so seeding is idempotent and order-independent under last-writer-wins.
- **File-manifest SQLite projection** (migration 069) — `FileManifest` now hydrates from a durable SQLite cache and keeps it in sync, so the manifest survives a restart without the Yjs document.
- **Delta-log presence wiring** — `reportPresenceViaDeltaLog` / `refreshOnlineDevicesFromDeltaLog` are now called from the orchestrator's presence tick, bridging the device roster into the existing peer-discovery read path.

### Fixed & Improved

- **CORS preflight blocked the delta-log API** — the server only allowed `Content-Type`, rejecting the `X-Sync-*` auth headers every signed request carries; fixed and deployed server-side.
- **"New room" did nothing on desktop** — `SyncSettings` used the native `confirm()` (a no-op in WKWebView); switched to the in-app modal.
- **Orchestrator silently no-op'd** — empty sync URL with no default fallback; now falls back to `wss://sync.readsync.org`.
- **Startup lag when sync enabled** — the seed (1400+ rows) ran on the boot critical path (~19s stall); now fire-and-forget, startup is back to <1s.
- **Drain gate never satisfied** — it polled the *global* scheduler to idle, but the scheduler is shared with replicators that never stop; relaxed to a bounded settle period gated on dead-letters only.
- **Orchestrator behavior invisible in logs** — webview `console.*` doesn't surface in Rust stdout; routed through `@tauri-apps/plugin-log`.
- **Missing i18n keys** — all 21 `syncSettings.deltaLog.*` labels rendered as raw key strings; added to the English locale.
- **Migration panel didn't scale on mobile** — the domain table overflowed and the device roster wrapped badly; rebuilt with responsive Tailwind breakpoints (card grid on phone, table on desktop).
