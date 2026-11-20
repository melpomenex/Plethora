## ADDED Requirements

### Requirement: OAuth authorization protects against CSRF, replay, and secret exposure
The system SHALL generate per-attempt CSPRNG `state` tokens and PKCE S256 challenges stored with a 10-minute TTL and single-use consumption in `HealthOAuthManager`, SHALL bind desktop callbacks strictly to `127.0.0.1`, SHALL NOT embed confidential OAuth client secrets in desktop or mobile binaries, and SHALL perform confidential exchanges via the stateless server broker (`server/src/routes/v1/healthOAuth.ts`) without persisting health observations server-side.

#### Scenario: Replayed or mismatched OAuth state is rejected
- **WHEN** an OAuth callback presents an expired, unknown, already-consumed, or provider-mismatched `state`
- **THEN** `HealthOAuthManager` rejects the callback before exchanging tokens and stores zero credentials

### Requirement: Providers expose honest readiness states and capability gating
Each wearable provider in the catalog SHALL compute its runtime readiness state (`available`, `not_configured`, `requires_developer_approval`, `connected`, `permission_revoked`, `rate_limited`, `unsupported`, `feature_disabled_compliance`) from platform OS, broker configuration, and consent/token status, and SHALL block connection attempts for unconfigured or unapproved providers.

#### Scenario: Unapproved commercial Garmin or Google Health connector stays gated
- **WHEN** `garmin` or `google_health` lacks configured approved commercial credentials
- **THEN** its readiness state reports `requires_developer_approval`, connection initiation is refused cleanly, and the UI directs the user to supported mobile aggregator paths

### Requirement: Cloud connectors parse vendor payloads faithfully and handle API errors
Oura v2, WHOOP v2, Google Health v4, and Garmin Health API parsers SHALL map vendor sleep, stages, HRV (`rmssd` vs `sdnn`), resting heart rate, and proprietary recovery scores (only when scored) without inventing missing intervals or querying deprecated Fitbit Web API endpoints, and SHALL handle `429 Retry-After`, `401` token refresh/revocation, `403 MISSING_OAUTH_SCOPE`, and pagination tokens deterministically.

#### Scenario: Oura 5-minute hypnogram and WHOOP stage summary preserve stage fidelity
- **WHEN** Oura returns `sleep_phase_5_min` and WHOOP returns `score.stage_summary`
- **THEN** Oura produces timestamped 5-minute `SleepStageInterval` records while WHOOP populates aggregate stage durations without fabricating interval timestamps

#### Scenario: WHOOP webhook rejects spoofed signature or stale timestamp
- **WHEN** `POST /v1/health-oauth/whoop/webhook` receives an invalid `X-WHOOP-Signature` HMAC-SHA256 or timestamp older than 300 seconds
- **THEN** the broker responds with HTTP `401` and does not accept the event
