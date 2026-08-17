## ADDED Requirements

### Requirement: Quota envelopes are server configuration
Per-capability usage limits (unit, period, limit) SHALL live in server-side `quota_envelopes` joined with account grants — modifiable without client release. Clients SHALL never embed authoritative limits (offline fallback display values only, marked advisory).

#### Scenario: Tightening a quota needs no app update
- **WHEN** an operator reduces a capability's monthly limit
- **THEN** the next `GET /v1/usage` reflects it and enforcement begins immediately server-side

### Requirement: Usage is metered transactionally with job completion
Every completed (or failed-after-work) job SHALL write `usage_records` (account, capability, job, units, cost_usd_micros, provider, model) in the same transaction as state transition. `GET /v1/usage` SHALL return proposal-2 `QuotaState { used, limit, window, resetsAt }` per capability; API responses SHALL carry `X-Quota-Limit`, `X-Quota-Used`, `X-Quota-Remaining` headers.

#### Scenario: True units recorded
- **WHEN** a transcription job processes 41 minutes against a 30-minute estimate
- **THEN** usage records 41 minutes and the visible quota reflects actual consumption

### Requirement: Pre-flight enforcement with defined overage policy
Job submission SHALL check envelopes before queuing (`429 quota_exceeded`, `retryAfter` = window reset). Work already started when quota exhausts SHALL follow the capability's configured grace policy (default: complete started work, flag the excess) — behavior identical across kinds.

#### Scenario: Pre-flight rejects cleanly
- **WHEN** a Free-tier user submits a Pro-capability job
- **THEN** the request is rejected with a capability `reason: "plan"` mapping, not executed

### Requirement: Rate limiting protects the service
Per-account and per-IP token-bucket rate limits SHALL apply to all `/v1/*` routes with `429 code=rate_limited` + `Retry-After`. Limits are per-route-class configuration; abuse patterns (sustained 429s) SHALL emit events for observability (proposal 24).

#### Scenario: Burst throttled
- **WHEN** a client exceeds its request bucket
- **THEN** excess requests receive `429 rate_limited` without executing work

### Requirement: Abuse prevention and payload hygiene
Request payloads SHALL be size-capped per route; user-supplied URLs SHALL pass SSRF validation (private/reserved-range blocking, mirroring the app's `security.rs` guard); logs SHALL NOT contain document/content payloads — only ids, kinds, units, and errors.

#### Scenario: SSRF attempt rejected
- **WHEN** a capture job targets `http://169.254.169.254/`
- **THEN** validation rejects the URL before any fetch occurs
