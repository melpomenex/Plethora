# entitlement-persistence Specification

## Purpose
Defines the entitlement authority model, durable account-scoped persistence of server-verified snapshots, failure provenance (never stamping fallbacks as fresh), token-expiry handling, race protection, offline grace semantics, logout/account-switch isolation, legitimate downgrade behavior, the server's 401 contract, and UI gating without flicker.

## ADDED Requirements

### Requirement: Consistent Entitlement Wire Format
Native entitlement snapshots crossing the IPC boundary SHALL use the same camelCase field names the frontend types expect (`fetchedAt`, `accountId`, `expiresAt`), and a round-trip test SHALL pin the mapping.

#### Scenario: Native refresh consumed by the frontend
- **WHEN** the frontend applies a snapshot returned by a native entitlement command
- **THEN** `fetchedAt`, `accountId`, and capability fields SHALL be readable (never `undefined` due to naming mismatch)

### Requirement: Authoritative Source of Truth
The Plethora server's entitlement endpoint SHALL remain the only authority that changes a client's plan identity. The client SHALL cache the last server-verified snapshot durably per account and SHALL treat store-purchase state as an input to server reconciliation, never as direct client-side authority.

#### Scenario: Verified purchase flows through the server
- **WHEN** a store transaction is verified on the client
- **THEN** entitlement changes SHALL arrive via a subsequent server-verified entitlement response, not from billing-provider state directly

### Requirement: Durable Per-Account Native Persistence
The native entitlement cache SHALL persist the last server-verified snapshot per account in local application storage keyed by account ID, SHALL reload it when the process restarts for the signed-in account before any network-dependent resolution, and SHALL never synchronize these snapshots across devices through the settings sync.

#### Scenario: Process recreation restores verified state
- **WHEN** the native entitlement manager is reconstructed on a restart for a previously verified Pro account
- **THEN** the durable verified Pro snapshot SHALL be available before the refresh completes
- **AND** the UI SHALL not render confirmed Free during that window

#### Scenario: No cross-account leakage
- **WHEN** account A (Pro) signs out and account B (Free) signs in on the same install
- **THEN** B SHALL resolve Free
- **AND** A's persisted snapshot SHALL remain stored under A's key without being active

### Requirement: No Free From Failure
A previously server-verified Pro account SHALL NOT become Free due to application restart, empty in-memory cache, hydration ordering, request timeout, transient network failure, server 5xx, expired access token with a valid refresh token, billing-provider initialization, stale async responses, or local default initialization. A fallback or default snapshot SHALL never be cached, persisted, or timestamped as though it were server-verified.

#### Scenario: Cold restart offline
- **WHEN** a verified Pro account relaunches the app with no network
- **THEN** the entitlement state SHALL remain Pro with stale/offline verification status

#### Scenario: Entitlement endpoint failure
- **WHEN** the startup refresh fails with a network error or HTTP 5xx
- **THEN** the last verified snapshot SHALL be retained unchanged including its original fetched-at timestamp

#### Scenario: Empty memory cache cannot overwrite persistence
- **WHEN** a refresh runs before the session is mirrored or while the cache is empty and the fetch cannot produce a verified result
- **THEN** no Free default SHALL be written to the in-memory cache or the durable store

### Requirement: Typed Refresh Outcomes
The native refresh operation SHALL return a typed outcome — `verified`, `stale_cache`, `auth_expired`, or `anonymous` — where only `verified` writes the durable store, `stale_cache` returns the retained snapshot without altering timestamps, `auth_expired` indicates the server rejected the presented bearer, and `anonymous` (no signed-in session) returns Free defaults without persisting them.

#### Scenario: Failed refresh preserves provenance
- **WHEN** a refresh fails for a signed-in account with a persisted Pro snapshot
- **THEN** the outcome SHALL be `stale_cache` carrying the untouched snapshot

### Requirement: Server Distinguishes Rejected Bearers From Anonymous
The entitlement endpoint SHALL return 401 with a machine-readable code when a bearer token was presented but rejected (expired or invalid), and SHALL return the anonymous Free snapshot with 200 only when no bearer token was presented. Requests without a bearer SHALL behave exactly as before.

#### Scenario: Expired token presented
- **WHEN** the client requests entitlements with an expired access token
- **THEN** the server SHALL respond 401 identifying token expiry rather than 200 Free

#### Scenario: No token presented
- **WHEN** an anonymous client requests entitlements
- **THEN** the server SHALL respond 200 with the anonymous Free snapshot

### Requirement: Access-Token Expiry Handling
When the entitlement refresh reports `auth_expired`, the client SHALL refresh the access token using the refresh token, retry the entitlement refresh once, and SHALL NOT translate token expiry into a Free downgrade. If the refresh token itself is rejected, the client SHALL follow the existing session-security policy (sign out) rather than fabricate authenticated state.

#### Scenario: Expired access token, valid refresh token
- **WHEN** a Pro account's 15-minute access token has expired but the refresh token is valid
- **THEN** the client SHALL refresh the token, retry, and end verified Pro

#### Scenario: Rotated tokens reach native auth
- **WHEN** the frontend refresh rotates the access token
- **THEN** the native auth session SHALL be updated with the rotated token before subsequent native requests

### Requirement: Race Protection
Concurrent entitlement refreshes SHALL be guarded by a monotonic generation (or equivalent) such that a stale response — including one issued before a newer response completed — cannot overwrite newer state, and a response SHALL only ever apply to the account it was fetched for: apply-time account validation on both the native active-snapshot slot and the frontend store SHALL discard or redirect a response whose account no longer matches the active session.

#### Scenario: Older request resolves last
- **WHEN** refresh A starts with an old session, refresh B completes with Pro, and refresh A later completes with Free defaults
- **THEN** the applied state SHALL remain B's Pro result

#### Scenario: Mid-flight account switch
- **WHEN** a refresh issued for account A completes after the session switched to account B
- **THEN** A's response SHALL NOT become B's active snapshot on any layer
- **AND** A's verified snapshot MAY still be persisted under A's own account key

#### Scenario: Sign-out during in-flight refresh
- **WHEN** a refresh issued for account A completes after the user signed out
- **THEN** the active session SHALL remain anonymous Free

### Requirement: Offline Grace Preserves Plan Identity
Past the offline grace window, the client SHALL preserve the account's plan identity while degrading server-dependent capabilities to unavailable/offline with an appropriate verification status (e.g. "offline verification needed"), rather than reporting the plan as Free.

#### Scenario: Four days offline
- **WHEN** a Pro subscriber's device has been offline past the grace window
- **THEN** the plan SHALL remain Pro, cloud capabilities SHALL read as unavailable/offline, and the UI SHALL be able to indicate stale verification

### Requirement: Legitimate Downgrade
An authoritative server-verified Free response for the same account SHALL downgrade a previously Pro client to Free, persisting the change. This is the only client-visible downgrade path besides explicit logout and account switching; "once Pro, always Pro" is explicitly not implemented.

#### Scenario: Server says Free
- **WHEN** a verified refresh for a previously Pro account returns plan Free
- **THEN** the client SHALL apply and persist Free

### Requirement: Logout and Account Switching
Explicit logout SHALL immediately leave the active session in anonymous Free state in both native and frontend stores, clearing the active in-memory snapshot, while persisted per-account snapshots MAY remain on disk keyed by account for future sign-ins without ever being active while logged out.

#### Scenario: Logout shows no lingering Pro
- **WHEN** a Pro user signs out
- **THEN** the UI SHALL immediately reflect the anonymous Free state

#### Scenario: Switch back restores cached verified state
- **WHEN** account B signs out and Pro account A signs back in on the same install
- **THEN** A's last verified snapshot SHALL be restored pending a fresh refresh

### Requirement: Billing Initialization Cannot Reset Entitlements
Billing-provider selection and initialization SHALL NOT write entitlement state; verified store transactions MAY trigger a refresh, which is subject to the same race protection and failure-provenance rules.

#### Scenario: Mock billing provider initializes
- **WHEN** a dev/mock billing provider initializes while a server-verified Pro snapshot is active
- **THEN** the entitlement state SHALL remain the verified Pro snapshot

### Requirement: Flicker-Free UI Gating
UI plan/Pro displays SHALL consume central selectors derived from the entitlement store's snapshot and verification status, SHALL NOT independently interpret partial startup state, and SHALL NOT briefly advertise an upgrade to a known Pro account during normal hydration or fresh login.

#### Scenario: Known Pro account during hydration
- **WHEN** the app starts for an authenticated Pro account
- **THEN** the profile and paywall-adjacent surfaces SHALL NOT flash an upgrade prompt before the refresh completes

#### Scenario: Fresh login
- **WHEN** a Pro user signs in
- **THEN** the UI SHALL show Pro immediately from the auth-verified login response, confirmed by the first refresh

### Requirement: Startup Ordering
Application startup SHALL establish account/session identity (including token validity) before entitlement refresh and before billing-triggered refreshes can resolve against an unmirrored session, and SHALL refresh entitlement state on startup in both native and browser/PWA modes.

#### Scenario: Billing init triggers early refresh
- **WHEN** billing initialization triggers an entitlement refresh during startup
- **THEN** the refresh SHALL resolve consistently with the already-mirrored account session or be safely superseded by it

#### Scenario: PWA reload refreshes from the server
- **WHEN** an authenticated browser/PWA session reloads the application
- **THEN** the entitlement state SHALL be refreshed from the server rather than left at a stale local snapshot
