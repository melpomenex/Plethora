# Plethora Pro Sync — GA Readiness Checklist

Mapped to PRD §66 acceptance criteria. Each item links to automated coverage or a manual verification step.

| Criterion | Verification |
| :--- | :--- |
| Local journal captures all syncable mutations atomically | `src-tauri/src/sync/outbox.rs` unit tests; migration 106 |
| Push/pull idempotency and cursor monotonicity | `server/src/__tests__/syncPushPull.test.ts` |
| Two-device convergence (reviews, LWW, tombstones) | `src-tauri/src/sync/convergence_test.rs` |
| Pro entitlement gates sync worker and API | `server/src/middleware/requireCloudSync.ts`; `src-tauri/src/sync/gate.rs` |
| E2EE at wire boundary with epoch rotation | `src-tauri/src/sync/chaos_test.rs`; `src-tauri/src/sync/crypto.rs` |
| Recovery key stored in platform secure storage | `src-tauri/src/sync/keys.rs`; `syncStore` no longer persists recovery key |
| Blob dedupe + quota enforcement | `server/src/routes/v1/blobs.ts`; `server/src/__tests__/syncBlobs.test.ts` |
| Scheduler debounce, retry backoff, lifecycle hooks | `src-tauri/src/sync/scheduler.rs`; `src-tauri/src/sync/retry.rs` |
| Conflict surfacing and resolution | `src-tauri/src/sync/issues.rs`; `SyncSettingsPanel` conflict UI |
| Privacy-preserving telemetry (no plaintext) | `src-tauri/src/sync/telemetry.rs`; migration 108 |
| Rollback: `PLETHORA_SYNC_V2=0` disables worker, preserves outbox | `src-tauri/src/sync/flags.rs` manual check |
| Default on for Pro when env unset | `sync_v2_enabled(None)` with Pro entitlement |

## Rollout

1. Deploy server with `/v1/sync` and `/v1/blobs` routes plus `requireCloudSync` middleware.
2. Set `PLETHORA_SYNC_V2=1` in staging; verify two-device sync.
3. Remove env override in production — Pro users get sync by default.
4. Monitor sync telemetry events for failure rate regressions.

## Rollback

Set `PLETHORA_SYNC_V2=0` on clients. Local SQLite outbox and domain data remain intact; cloud push/pull stops until re-enabled.
