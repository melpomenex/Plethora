## ADDED Requirements

### Requirement: The public API is versioned, documented, and contract-tested
Cloud API routes SHALL live under `/v1/api/*` with an OpenAPI document generated from the zod schemas and contract tests enforcing route/method/schema/response conformance. Within v1, changes SHALL be additive; deprecations SHALL carry headers and changelog entries.

#### Scenario: Contract tests catch drift
- **WHEN** a response shape diverges from the OpenAPI document in CI
- **THEN** the contract test fails

### Requirement: API tokens are scoped and managed
Tokens SHALL support the documented scope set (`read`, `write`, `capture:write`, `webhooks`, `cards:write`, `reviews:write`), be hashed at rest, rotatable and revocable from a management UI with last-used tracking, and rate-limited per class. Scope enforcement SHALL be deny-by-default at middleware.

#### Scenario: Scope denial
- **WHEN** a `read`-scoped token calls a write endpoint
- **THEN** the request is rejected with a scope error and no side effects

### Requirement: The E2E boundary is preserved in API design
The cloud API SHALL expose account-held data (inbox/capture, pushed metadata, usage) and create/submit operations, but SHALL NOT expose E2E-encrypted synced library content. Reading library content programmatically happens via the local API/MCP on the user's device. This boundary SHALL be documented in the API reference.

#### Scenario: Synced content is not cloud-readable
- **WHEN** any cloud API route is enumerated
- **THEN** none returns decrypted synced document/extract content

### Requirement: Webhooks are signed, retried, and content-free
Event deliveries SHALL be HMAC-signed per token, idempotent by event id, retried with bounded backoff into a dead-letter state, and carry only ids/metadata — never document or extract content. Targets SHALL be SSRF-validated.

#### Scenario: Tampered signature rejected
- **WHEN** a receiver ignores validation and the test harness tampers a signature
- **THEN** the documented verification recipe fails the delivery

#### Scenario: No content in payloads
- **WHEN** webhook payloads are scanned across the event catalog in tests
- **THEN** no document/extract body text is present

### Requirement: The event catalog is explicit
Supported events (document imported/completed, extract created, card created, review completed, gap identified, due-item/card digests, connection discovered) SHALL be individually subscribable with caps per endpoint; due-events SHALL be digests, not per-item deliveries.

#### Scenario: Due digest batches
- **WHEN** 40 cards are due
- **THEN** a single digest event delivers counts and ids, not 40 deliveries

### Requirement: Local automation extends with an event bridge
The existing local automation API (key-authenticated) SHALL gain event-emission matching the cloud catalog where data is local, without changing the existing endpoint auth model or MCP tool behavior.

#### Scenario: Local bridge parity
- **WHEN** the same subscription logic runs against the local bridge
- **THEN** event names and payload shapes match the cloud catalog

### Requirement: Capabilities gate the tiers
Cloud API/webhooks SHALL require `api_access`/`automation` capabilities respectively; the local API, MCP server, and existing integrations SHALL continue to work without any subscription.

#### Scenario: Local power stays free
- **WHEN** a Free user rotates the local automation key and calls local endpoints
- **THEN** everything functions exactly as before
