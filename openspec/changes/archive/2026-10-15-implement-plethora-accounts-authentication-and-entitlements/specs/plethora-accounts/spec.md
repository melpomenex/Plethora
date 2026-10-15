## ADDED Requirements

### Requirement: Accounts are optional and never gate local content
The app SHALL remain fully functional for reading, extraction, scheduling, review, and local AI/TTS without an account. Authentication state SHALL NOT be consulted by any reader, viewer, queue, or review component. Sign-out SHALL remove cloud credentials only; local documents, extracts, decks, and settings SHALL be preserved (test-enforced).

#### Scenario: Sign-out preserves the library
- **WHEN** a signed-in user signs out
- **THEN** all local documents, extracts, learning items, review history, and settings remain intact and the app continues operating anonymously

#### Scenario: Anonymous cold start makes no auth network calls
- **WHEN** the app launches signed-out
- **THEN** zero authentication or entitlement network requests are initiated

### Requirement: Token lifecycle uses short access + rotating refresh tokens
Authentication SHALL use access tokens (≤15 min TTL) and rotating refresh tokens (revocable per-device/session). Refresh-token reuse SHALL invalidate the entire token family. Clients SHALL auto-refresh exactly once on `401 code=token_expired` with single-flight semantics and SHALL drop to signed-out state on `code=session_revoked` without data impact.

#### Scenario: Refresh rotation detects reuse
- **WHEN** a previously rotated refresh token is replayed
- **THEN** the token family is revoked and the device's next refresh fails

#### Scenario: Concurrent 401s trigger one refresh
- **WHEN** multiple in-flight requests receive token-expired responses simultaneously
- **THEN** exactly one refresh request is issued and all requests are retried with the new token

### Requirement: Device registry with per-device keys and revocation
Each install SHALL generate a persistent device keypair registered server-side (`devices`: name, platform, public key). Users SHALL be able to list and revoke devices; a revoked device's sessions and sync access (proposal 6) terminate within one refresh/sync cycle.

#### Scenario: Device revocation takes effect
- **WHEN** a user revokes a device from another device
- **THEN** the revoked device transitions to signed-out on its next auth/sync interaction and its local data remains intact

### Requirement: Entitlement snapshot endpoint honors the capability contract
`GET /v1/entitlements` SHALL return the proposal-2 `EntitlementSnapshot` shape (plan, per-capability enabled/reason, quotas, expiry) derived from server-side grants — never from client input. Anonymous requests are unauthenticated-only endpoints; the client SHALL fetch entitlements on sign-in, on focus, and after billing events.

#### Scenario: Snapshot reflects grants not tiers
- **WHEN** the grants store changes (trial added, quota adjusted) without a tier-label change
- **THEN** the next snapshot reflects the new capabilities/quotas directly

### Requirement: Credentials are stored securely and never logged
Tokens SHALL be stored via the OS keychain (`com.plethora.app.account` service) with the existing AES-256-GCM encrypted-file fallback pattern. Deep-link/OAuth callbacks SHALL exchange one-time codes server-side; tokens SHALL NOT appear in URLs or logs.

#### Scenario: No secrets in logs
- **WHEN** auth flows run with verbose logging enabled
- **THEN** access/refresh tokens and one-time codes are redacted from all log output

### Requirement: OAuth providers share the account record
Sign-in with Apple/Google SHALL create or link to the same account record as email/password, unifying entitlements and device registry. The legacy 501 `oauth.ts` stub SHALL be replaced.

#### Scenario: Same email links accounts
- **WHEN** a user registers by password and later signs in with an OAuth provider returning the same verified email
- **THEN** the existing account is linked rather than duplicated
