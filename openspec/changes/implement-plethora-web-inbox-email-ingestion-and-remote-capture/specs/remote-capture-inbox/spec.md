## ADDED Requirements

### Requirement: Remote capture feeds the standard pipeline
Captured items (URL fetch or provided content) SHALL be extracted and sanitized by the same engine selection/scoring logic as on-device import (shared isomorphic module — no client/server fork), arrive in a remote inbox, and on accept enter the local library through the normal import path with content-hash dedup ("already in library" outcome).

#### Scenario: Server extraction matches client
- **WHEN** the shared extraction module runs on the article-import fixture corpus server-side
- **THEN** outputs are byte-identical to client golden outputs

#### Scenario: Duplicate capture is honest
- **WHEN** a captured URL matches an existing document's content hash on accept
- **THEN** the inbox reports already-in-library instead of duplicating

### Requirement: URL fetching is bounded and safe
Server fetches SHALL enforce SSRF rejection (private/reserved ranges incl. metadata IPs, re-validated per redirect), size/time caps, a declared UA, and per-domain rate limits. Failures (paywalled, fetch errors) SHALL surface honestly with an on-device retry option.

#### Scenario: SSRF blocked
- **WHEN** a capture targets a private address or metadata endpoint
- **THEN** the fetch is refused before any request leaves

### Requirement: Email capture is allowlisted and capped
Email-to-Plethora SHALL use per-account rotating addresses; inbound SHALL be restricted by sender allowlist, attachment type/size caps, and per-day limits; parsed bodies and supported attachments SHALL become inbox items; everything else is dropped with an auditable (content-free) event.

#### Scenario: Unknown sender dropped
- **WHEN** mail arrives from a non-allowlisted sender
- **THEN** no inbox item is created and the event is logged without content

### Requirement: Capture is authenticated, quota-gated, and abuse-controlled
All `/v1/capture/*` endpoints SHALL require authentication (session or API token with `capture:write`); usage SHALL meter under the `web_capture` envelope (items/month) with `429 quota_exceeded`; payload caps and rate limits apply per route.

#### Scenario: Quota gates remote capture
- **WHEN** the monthly capture envelope is exhausted
- **THEN** further remote captures reject with quota reason while all on-device capture remains unlimited and free

### Requirement: Inbox lifecycle is explicit and syncing
Inbox items SHALL present source/title/excerpt/tags with accept (collection/queue placement) / dismiss / bulk actions; state SHALL reach devices via sync or pull; items SHALL NOT auto-enter the library without acceptance (except under an explicit per-user auto-import setting).

#### Scenario: Accept places correctly
- **WHEN** a user accepts an inbox item into a collection with queue placement
- **THEN** it imports exactly as an on-device import would into that target

### Requirement: Native share capture is regression-protected
Android SEND/VIEW intents and the PWA share-target SHALL continue to function identically; remote capture is strictly additive. Explicit regression suites SHALL cover both native paths.

#### Scenario: Share sheet unchanged
- **WHEN** the Android share-sheet and PWA share-target regression suites run
- **THEN** all pre-change behaviors pass without modification

### Requirement: Extension cloud relay is opt-in and local-first
The browser extension SHALL retain local (localhost) mode as default; cloud relay SHALL require explicit sign-in and activate when the app is unreachable; relay failures fall back to local queues.

#### Scenario: Relay when app closed
- **WHEN** the user saves a page with the desktop app not running and relay enabled
- **THEN** the page captures via the cloud and later appears in the inbox
