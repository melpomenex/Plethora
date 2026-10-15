# Change: Implement Plethora Pro Cloud Service and Usage-Quota Architecture

> Wave 1 — Commercial Foundation. Hard-depends on `establish-plethora-commercial-product-foundation` (quota types) and rebrand. Co-owned surface with proposal 3 (auth endpoints) — this change owns the **service framework**: middleware, jobs, quotas, metering, provider abstraction, deployment. Every cloud-capability proposal (6, 16–20, 24) builds on it instead of inventing its own.

## Why

Pro features (sync, document reconstruction, premium TTS, transcription, remote capture, API) are all "authenticated user submits expensive asynchronous work; quota-checked, metered, retried, observable work executes; client observes progress". Building that once — with cost controls and abuse prevention — is the difference between a sustainable service and an open AI bill. The existing Express server (`server/`, deprecated sync routes + JWT auth + Postgres) is the starting skeleton; this change turns it into the **Plethora Cloud service** (`cloud/` responsibilities kept in `server/` to avoid churn; module renamed logically, repo layout unchanged).

## What exists today
- `server/`: Express 4.21 + helmet/cors/compression + Postgres (pg pool max 20) + bcryptjs/JWT auth + zod; routes: deprecated `/sync`, `/files` (multer 100MB), `/api/documents`, `/api/video-extracts` (ts-fsrs), 501 `/auth/oauth`; Docker + docker-compose self-host stack; deployed nowhere production today.
- Client job-queue precedents in Rust: `transcription/job_queue.rs` (status/retry/priority/cancel, mpsc worker, startup reset processing→pending) and `ai_learning/indexer.rs` (bounded background worker, pause/resume/cancel, progress events) — proven patterns to mirror server-side.
- Quota/metering: nothing. AI pricing data exists client-side (`ModelPricing` in `commands/llm.rs`, `llmProvidersStore` model pricing) — reusable reference for cost accounting.
- Rate limiting: none in server. Abuse: `security.rs` SSRF guard exists client-side.

## What Changes

### 1. Service framework (`server/`)
- API surface convention: versioned `/v1/*` (legacy `/sync`+`/files` routes removed — already sunset-flagged); uniform error envelope `{ error: { code, message, retryable, retryAfter? } }`.
- Middleware stack: request-id, structured JSON logs (no content payloads — privacy requirement), auth (proposal 3), **rate limiter** (token bucket per-account + per-IP, Redis or in-memory v1), zod request validation, payload caps.
- Config via env with sane defaults; `PLETHORA_ENV` (dev/staging/prod); secrets never in code (the committed Android keystore lesson applied here).
- Postgres schema (additive, versioned migrations tooling — extend `server/src/db/migrate.ts`): `accounts`-side tables (proposal 3), plus `jobs`, `job_events`, `usage_records`, `quota_state`, `capability_grants`, `provider_keys` (encrypted at rest), `webhook_dedupe` (proposal 4).

### 2. Job system (the core shared primitive)
- `POST /v1/jobs` `{ kind, params, idempotency_key? }` → `202 { job_id }`; `GET /v1/jobs/:id` → `{ id, kind, status: queued|running|succeeded|failed|cancelled, progress?: {current,total,unit}, result?, error?, created_at, updated_at }`; `DELETE /v1/jobs/:id` (cancel); `GET /v1/jobs?since=&kind=` (client resync); optional SSE `GET /v1/jobs/:id/events` (progress streaming; pull fallback must exist for constrained networks).
- Kinds are registered server-side (`document_reconstruct`, `tts_generate`, `transcribe`, `embed_batch`, `capture_fetch`, `export`, …) — each owned by its feature proposal; this change owns the framework + first reference kind.
- Worker model: async queue (Postgres-backed `FOR UPDATE SKIP LOCKED` v1 — no extra infra; swap-able interface), **per-kind concurrency limits**, timeouts, retry with exponential backoff + jitter (max attempts per kind), idempotency keys dedupe client retries, cancellation checkpoints in long jobs, resume/partial results where the kind supports it.
- Job state transitions auditable; results stored with TTL per kind; large artifacts go to object storage (S3-compatible; storage quota accounted), never DB blobs.

### 3. Quotas, metering, cost controls
- Quota envelopes per capability per period (e.g. `premium_tts: { characters_per_month }`, `cloud_document_processing: { pages_per_month }`, `transcription: { minutes_per_month }`, `cloud_sync: { storage_bytes }`); defined in `capability_grants`/`quota_envelopes` config — **numbers are product config, not code**.
- `GET /v1/usage` → per-capability `{ used, limit, window, resetsAt }` (proposal-2 `QuotaState`); responses carry `X-Quota-Limit/-Used/-Remaining` headers; `429 code=quota_exceeded` with `resetsAt`.
- Metering: `usage_records` (account, capability, job_id, units, cost_usd_micros, provider, model) written transactionally with job completion; **per-account daily cost ceilings** (hard stop + alert) and service-wide budget guards (kill switch per kind) — no unlimited expensive compute by construction.
- Pre-flight checks at job creation; running jobs over-quota at completion are completed but flagged (never billed silently to the user beyond envelope policy — grace policy per capability, default: finish started work).

### 4. AI/compute provider abstraction (server-side)
- `ProviderRegistry` for LLM/embedding/TTS/OCR/transcription vendors: keyed credentials (per-provider, per-deployment), health tracking, cost accounting per call, timeouts/circuit-breakers. Mirrors the client-side philosophy (`commands/llm.rs` provider set, `ai/embeddings.rs`, TTS registry) — the app never becomes permanently dependent on one vendor; task→provider-class routing config.
- Never send more than the task needs (chunking server-side mirrors client `DocumentSegmenter` behavior).

### 5. Client SDK
- `src/lib/plethoraCloud/` (TS) + `src-tauri/src/plethora_cloud/` (Rust): typed client for auth'd endpoints, job polling/SSE abstraction with backoff, offline submission queue (bounded, replayed on reconnect — lessons from deleted offline-queue.ts), quota helpers, error taxonomy mapping to proposal-2 reasons (`quota_exhausted`, `offline`, `unavailable`).
- Reference Rust job-runner trait so feature proposals implement `CloudJobHandler` client-side (progress UI, cancellation) without touching transport.

### 6. Deployment
- Evolve `server/Dockerfile` + compose; production target documented (container on a modest VPS or PaaS; Postgres managed or composed; S3-compatible storage env). Domain wiring per proposal 1's Open question (`api.plethora.app` placeholder). Secrets via env/secret manager. This change ships deployment docs + staging environment; production cut-over tracked in proposal 23/24 readiness.

## Impact

### Affected Specs
- `plethora-cloud-jobs` — New (job lifecycle contract).
- `usage-quotas` — New (envelopes, metering, cost ceilings, headers).

### Affected Code Areas
- `server/**` (framework, middleware, migrations, jobs, quotas); new `src/lib/plethoraCloud/`, `src-tauri/src/plethora_cloud/`; removal of deprecated `/sync`+`/files` routes; docs (`docs/` deployment + API docs).

### Non-goals
- No feature job kinds (owned by 16–20), no sync engine (6), no billing validation (4), no observability stack (24 — but structured logs/metrics emission points defined here), no multi-region.

## Dependencies

### Hard dependencies
- Proposal 2 (QuotaState contract), rebrand (env prefix, service naming).

### Soft dependencies
- Proposal 3 (auth middleware contract-first; until landed, dev mode with static test tokens).

### May run concurrently
- 3 (auth), 4 (billing routes) after framework interfaces land; 24 (observability consumes emission points).

### Must not start yet
- Proposals 6, 16–20 (job kinds) until the job framework + SDK interfaces land (first milestone).

## Shared interfaces (owned here)
- `/v1/jobs` lifecycle API + error envelope + rate-limit semantics; `GET /v1/usage`; quota envelope config schema; `ProviderRegistry`; client `CloudJobService` (TS+Rust); `CloudJobHandler` trait for feature kinds; `usage_records` schema (consumed by 24).

## Ownership boundaries
- **May modify**: all of `server/` framework/middleware/db tooling, `plethora_cloud/` clients, deployment docs.
- **Must treat as external**: `/v1/auth/*` semantics (3), billing routes (4), sync domain logic (6), feature job handlers (16–20), dashboards (24).

## Collision risks
- `server/src/{index.ts,db/schema.ts,middleware/*}` shared with 3/4 — mitigate with contract-first commits and route-file-per-proposal. `lib.rs`/store registration (client SDK init).

## Integration contract
- Feature proposals register job kinds server-side (`jobs/registry.ts`) + implement client handlers; they consume `CloudJobService.submit/poll/cancel`, receive quota errors normalized, and must not build their own queues/transports.

## Testing & acceptance

### Tests
- Job lifecycle: submit→run→succeed/timeout/retry/backoff-jitter bounds; idempotency-key dedupe; cancel mid-run checkpoints; SKIP LOCKED concurrency correctness under parallel workers; progress events ordering.
- Quotas: pre-flight rejection, header propagation, mid-flight policy (finish-started-work), daily cost ceiling triggers kill switch, budget-guard kill switch per kind, reset-window rollover.
- Rate limits per account/IP; payload caps; uniform error envelope contract tests.
- Load: CI smoke (k6 or node script) on job submit/poll at target RPS with bounded p95 latency — baseline recorded per repo perf-gate philosophy (enforced in 24).
- Security: authz matrix (anonymous/Free/Pro × endpoints), no content payloads in logs, SSRF guard on any user-supplied URL kinds.

### Acceptance criteria
- Reference job kind runs end-to-end from the app (submit, progress, cancel, retry after induced failure) with quota headers and usage recorded; deprecated routes removed; staging deployment live behind auth; docs current.

### Must remain unchanged
- App behavior with `PLETHORA_API_URL=off`; all local features; existing client perf gates.

## Open questions
1. Infra choice (VPS vs PaaS; managed Postgres; S3 provider) — deployment decision recorded in env, code agnostic.
2. SSE vs websocket vs long-poll for job events on constrained mobile networks (v1 ships SSE + pull).
3. Quota grace policy per capability (finish-started vs hard-stop) defaults — product decision at config level.
