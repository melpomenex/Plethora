## Why

Desktop learners and users of dedicated wearables (Oura Ring, WHOOP, Google Health / Pixel Watch / Fitbit ecosystem, Garmin commercial program) benefit from direct authorized API connectors without needing a phone bridge, while remaining strictly protected against hardcoded client secrets, deprecated endpoints (legacy Fitbit Web API retired late 2026), unauthorized commercial API usage (Garmin Personal API), or deceptive unapproved UI states.

## What Changes

- Build reusable OAuth 2.0 + PKCE S256 framework (`src-tauri/src/health/oauth.rs`) with single-use 32-byte CSPRNG `state` CSRF validation, desktop ephemeral loopback callback server (`127.0.0.1:0`), mobile deep-link callback (`plethora://health/oauth/callback`), and redacted logging.
- Implement a stateless OAuth token-exchange & signed webhook endpoint module in `server/src/routes/v1/healthOAuth.ts` (never storing health data, never exposing confidential secrets to client binaries, verifying WHOOP `X-WHOOP-Signature` HMAC-SHA256 + timestamp skew).
- Implement rate-limit-aware HTTP client (`http_client.rs`) with `429` `Retry-After` backoff, exponential jitter, pagination, and structured error mapping.
- Implement Tier 1 connectors and provider catalog readiness gating (`src-tauri/src/health/providers/`): Oura Cloud API v2, WHOOP Developer API v2, Google Health API v4 (replacing retired Fitbit API), and Garmin Commercial Health API contract (plus explicit capability registry entries for Tier 2 ecosystems: Polar, Withings, Samsung Health, Suunto, Ultrahuman, RingConn).

## Capabilities

### New Capabilities

- `cloud-wearable-providers`: Reusable OAuth 2.0 + PKCE framework, stateless server-side OAuth broker & webhook signature verifier, rate-limited sync client, provider readiness state machine, Oura v2, WHOOP v2, Google Health v4, Garmin Commercial contract, and deterministic contract tests.

### Modified Capabilities

None.

## Impact

- **Native:** `src-tauri/src/health/{oauth.rs,http_client.rs}` and `src-tauri/src/health/providers/{mod.rs,catalog.rs,oura.rs,whoop.rs,google_health.rs,garmin.rs}`, plus deep-link redaction compatibility in `external_open.rs`.
- **Server:** `server/src/routes/v1/healthOAuth.ts` mounted under `/v1/health-oauth` in `server/src/index.ts`, plus `server/src/__tests__/healthOAuth.test.ts`.
- **Security:** Zero client secrets embedded in Rust or JS bundles; unconfigured/unapproved connectors stay visibly disabled (`not_configured` / `requires_developer_approval`).
