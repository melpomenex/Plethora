## ADDED Requirements

### Requirement: Single refresh owner on native
On Tauri builds, all access-token refresh SHALL go through Rust `AuthManager` refresh with its existing single-flight mutex.

#### Scenario: TS refresh delegates to native
- **WHEN** `accountStore.refresh()` is called on a Tauri build with a valid refresh token
- **THEN** the implementation invokes `account_refresh` and does not independently POST `/v1/auth/token/refresh`

#### Scenario: Concurrent native callers coalesce
- **WHEN** account refresh, sync scheduler refresh, and entitlement retry occur concurrently
- **THEN** only one network refresh is performed and the token family is not revoked

### Requirement: PWA single-flight refresh
On browser/PWA builds without Rust auth, concurrent refresh callers SHALL share one in-flight refresh promise.

#### Scenario: Concurrent PWA refresh
- **WHEN** two callers invoke `accountStore.refresh()` simultaneously on PWA
- **THEN** only one POST to `/v1/auth/token/refresh` occurs and both callers resolve with the rotated tokens

### Requirement: Stale refresh response must not sign out valid session
A refresh request that started with an outdated refresh token SHALL NOT sign the user out if the store already holds a newer refresh token from a winning concurrent refresh.

#### Scenario: Stale failure after winning refresh
- **WHEN** refresh request A starts with R1, request B rotates to R2, and A returns `session_revoked` for R1
- **THEN** the user remains signed in with R2

### Requirement: Legitimate session revocation still signs out
When a refresh token family is legitimately revoked (reuse attack), the system SHALL sign the user out cleanly.

#### Scenario: Genuine reuse detection
- **WHEN** a revoked refresh token is presented and no newer valid token exists locally
- **THEN** the user is signed out and entitlement state resets to anonymous Free per existing semantics

### Requirement: Entitlement persistence guards preserved
Failed or stale refreshes SHALL NOT manufacture Free snapshots or overwrite persisted Pro verified snapshots per existing entitlement-persistence requirements.

#### Scenario: Offline Pro grace
- **WHEN** network is unavailable and a valid Pro cached snapshot exists within grace
- **THEN** local plan identity remains Pro according to existing grace semantics
