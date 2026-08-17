# Design: Plethora Cloud Service Framework

## Context

Six+ proposals need authenticated, quota-gated, asynchronous, observable cloud compute. The Express/Postgres skeleton in `server/` exists but has: no refresh tokens, no rate limiting, no jobs, no quotas, no provider abstraction, deprecated sync routes. The client has proven job-queue patterns (`transcription/job_queue.rs`, `ai_learning/indexer.rs`) worth mirroring.

## Core decisions

### D1 — Postgres-backed job queue first
`jobs` table with `FOR UPDATE SKIP LOCKED` worker claims. No Redis/Queue infra in v1 (fewer moving parts; volumes here are AI-job-scale, not chat-scale). The `JobQueue` is behind an interface so a broker can swap in later. Job rows: `id (uuid), account_id, kind, params (jsonb), status, attempts, max_attempts, timeout_at, progress (jsonb), result_ref, error, idempotency_key (unique per account when set), created_at, updated_at, locked_by, locked_at`.

### D2 — Kinds are plugins to the framework
Each feature proposal registers `{ kind, schema (zod), timeout, maxAttempts, concurrency, quota: {capability, unit, estimate(params)}, handler }`. The framework provides: validation, authz, quota pre-flight, metering on completion, retries with jitter, cancellation checkpoints (handler polls `job.cancel_requested`), progress writes (rate-limited), artifact storage handles (S3 refs, signed URLs for download).

### D3 — Quota envelopes are config; enforcement is middleware + completion metering
`quota_envelopes` rows (capability, period, limit, unit) joined with account grants (proposal 4). Pre-flight estimates reject over-quota submissions (`429 quota_exceeded`). Completion metering records true units (pages/characters/minutes/tokens/bytes) into `usage_records` with `cost_usd_micros` from `ProviderRegistry` pricing. Two safety layers above quotas: per-account daily cost ceiling and per-kind global budget guard (kill switch) — both configurable, both alert (hooks for proposal 24).

### D4 — ProviderRegistry with circuit breakers
Server-side vendors are registered with: credential ref (env, never in DB plaintext), timeout, cost fn, health state (consecutive-failure circuit open). Task routing maps job kinds to provider classes; per-deployment overrides via env. Mirrors client abstractions so provider swaps never touch domain logic.

### D5 — Client SDK with offline submission queue
TS `src/lib/plethoraCloud/` wraps fetch with auto-refresh (via accountStore), single-flight, retry/backoff, and a bounded IndexedDB/localStorage pending-submission queue replayed on reconnect. Rust `plethora_cloud/` mirrors for background use. Both expose `CloudJobService` (submit/poll/cancel/subscribe) and normalize errors to proposal-2 reasons. Memory lesson from the deleted sync subsystem: **bounded queues, no unbounded caches, lazy pagination** — hard caps everywhere (lesson from `bound-sync-boot-memory`).

### D6 — Observability emission points from day one
Structured logs with request-id/account-id/kind/duration (no content), `/v1/admin/metrics` scrape endpoint shape defined here, filled by proposal 24. This ordering prevents retrofitting.

### D7 — Uniform error envelope
`{ error: { code, message, retryable, retryAfter? } }` with stable codes: `unauthenticated`, `token_expired`, `session_revoked`, `forbidden`, `quota_exceeded`, `rate_limited`, `invalid_input`, `not_found`, `conflict`, `provider_unavailable`, `internal`. Client maps directly to entitlement reasons.

## API sketch

```
POST /v1/jobs            {kind, params, idempotency_key?} -> 202 {job_id}
GET    /v1/jobs?since=   list for account (resync after offline)
GET    /v1/jobs/:id      status+progress+result_ref
DELETE /v1/jobs/:id      request cancel
GET    /v1/jobs/:id/events  SSE progress (pull fallback)
GET    /v1/usage         QuotaState[] per capability
```

## Database additions (Postgres, versioned)
`jobs`, `job_events` (append-only audit), `usage_records`, `quota_state` (materialized period counters), `capability_grants`, `quota_envelopes`, `provider_keys` (encrypted), `rate_limit_buckets` (if in-memory insufficient).

## Testing strategy
- Unit: envelope/quota math, backoff bounds, idempotency.
- Integration (testcontainers Postgres or embedded pg): full job lifecycle incl. crash-recovery (worker dies mid-job → lock expiry → retry), SKIP LOCKED under parallelism.
- Contract tests for error envelope + headers.
- CI load smoke with recorded baseline (enforced by proposal 24's gates).
