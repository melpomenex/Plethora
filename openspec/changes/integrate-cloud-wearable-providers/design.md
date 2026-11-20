## Context

Plethora's existing `server/` runs Express + TypeScript (`server/src/index.ts`) on port 3000 with Neon/Postgres. Existing `src-tauri/src/cloud/oauth.rs` has no shared `pending_state`/PKCE store or loopback server, so the health OAuth stack introduces a dedicated, clean PKCE + `HealthOAuthManager` implementation.

## Goals / Non-Goals

- **Goals:**
  - Confidential OAuth client secrets remain exclusively on the `server/` OAuth broker.
  - Honest provider readiness states prevent unapproved or unconfigured providers from presenting as connectable.
  - First-class contract tests validate pagination, refresh, `429` backoff, `401` revocation, `403 MISSING_OAUTH_SCOPE`, WHOOP stage-duration handling, Oura 5-min hypnogram parsing, and webhook HMAC verification against local mock servers.
- **Non-Goals:**
  - Embedding personal developer API keys or calling legacy Fitbit `api.fitbit.com` endpoints.
  - Storing wearable data on `server/` PostgreSQL or S3.

## Decisions

### Stateless OAuth Broker Pattern
Client generates PKCE `code_verifier`/`code_challenge` and `state`, opens provider consent URL, catches code via `127.0.0.1:0` loopback or `plethora://health/oauth/callback`, and sends `{ code, codeVerifier, redirectUri }` to `POST /v1/health-oauth/:provider/exchange` when a broker URL is configured. Tokens return directly to the client's `HealthTokenStore` and are never persisted by `server/`.

### WHOOP vs Oura Stage Fidelity
Oura `sleep_phase_5_min` yields exact 5-minute `SleepStageInterval` segments; WHOOP `/v2/activity/sleep` yields aggregate `stage_summary` millisecond totals (`total_light_sleep_time_milli`, etc.) without per-5-minute interval timestamps, so WHOOP stores accurate aggregate stage totals and session quality without fabricating synthetic stage intervals.

## Risks / Trade-offs

- **External credentials absent locally** → `GET /v1/health-oauth/providers` inspects server env vars; unconfigured providers render `not_configured` or `requires_developer_approval` in UI while all connector code and mock-server contract tests execute deterministically in CI.
