## ADDED Requirements

### Requirement: Shared capability resolver
Server entitlement and sync middleware SHALL use a single `resolveCapability(userId, capability)` function for tier and grant override logic.

#### Scenario: Entitlements and sync agree on cloud_sync
- **WHEN** a user has Pro tier with no grant override at a single DB snapshot
- **THEN** `GET /v1/entitlements` reports `cloud_sync.enabled: true` and sync middleware allows the request

#### Scenario: Grant override disables sync
- **WHEN** a capability grant sets `cloud_sync` to `enabled: false` for a Pro user
- **THEN** both entitlements response and sync middleware deny cloud sync

### Requirement: Distinct sync error codes in native client
The native sync client SHALL surface distinct error categories for sync auth failures without logging sensitive tokens.

#### Scenario: Device identity required
- **WHEN** sync push receives 403 `device_identity_required`
- **THEN** the client exposes a diagnosable error distinct from `capability_denied`

#### Scenario: Capability denied
- **WHEN** sync receives 403 `capability_denied`
- **THEN** the client exposes capability denial distinctly from device identity errors

### Requirement: Device identity errors remain distinct on server
Sync routes SHALL continue returning distinct error codes for `device_identity_required`, `device_identity_mismatch`, `device_revoked`, and `device_limit_reached`.

#### Scenario: JWT without deviceId
- **WHEN** a sync push is attempted with a JWT lacking `deviceId`
- **THEN** the server returns 403 `device_identity_required`
