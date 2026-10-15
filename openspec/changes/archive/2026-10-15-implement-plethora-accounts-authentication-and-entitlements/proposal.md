# Change: Implement Plethora Accounts, Authentication, and Entitlements

> Wave 1 — Commercial Foundation. Hard-depends on `establish-plethora-commercial-product-foundation` (snapshot contract) and `rebrand-incrementum-to-plethora`. Co-designed with `implement-plethora-pro-cloud-service-and-usage-quota-architecture` (proposal 5 owns the service framework; this change owns auth/account/entitlement endpoints and all client identity).

## Why

Pro capabilities require optional Plethora accounts: identity, secure authentication, device identity, entitlement retrieval, and clean separation of local data from cloud account state. Accounts must remain **optional** — a subscription is never required to open locally owned content — and the existing single-device app must keep working for anonymous users exactly as today.

## What exists today
- **Frontend**: `LoginModal.tsx` (email+password), `UserProfilePanel.tsx` (email, tier badge, logout, upgrade stub), `src/lib/sync-client.ts` — a slimmed JWT client (`login/register/logout/verifyAuth/getUser`) storing `incrementum_auth_token`/`incrementum_user` in localStorage against `VITE_API_URL || '/api'`. `reviewStore.ts` namespaces per-user session keys. `src/routes/auth-callback.tsx` handles the OAuth localhost redirect (`http://localhost:15173/auth/callback` used by cloud-backup providers).
- **Server**: `server/src/routes/auth.ts` — `POST /auth/register` (bcrypt cost 12), `POST /auth/login`, `GET /auth/verify`; JWT Bearer, 7-day expiry, no refresh tokens; Postgres `users` table (UUID, email, password_hash, `subscription_tier` default 'free'); `routes/oauth.ts` is a 501 stub.
- **Token storage (Rust)**: `cloud/auth_store.rs` AuthStore — OS keychain (service `com.incrementum.app`, gated by `INCREMENTUM_USE_KEYCHAIN`) with AES-256-GCM encrypted-file fallback in `<app_data>/tokens/`; used for OneDrive/Dropbox/GDrive OAuth tokens.
- **Sync client legacy**: the old REST sync was deprecated; only auth survived. Deleted Yjs sync carried lessons (pairing via QR, device ids).
- **Device identity**: none durable today (review_results has `device_id` columns from deleted sync; `backup manifest` carries a device_id).

## What Changes

### 1. Account model (server, owned here; runs on proposal 5's service)
- Endpoints under `/v1/auth`: `POST /register` (email+password, bcrypt≥12, zod validation), `POST /login`, `POST /logout` (revoke session), `POST /token/refresh`, `GET /account`. Replace 7-day JWTs with **short-lived access tokens (15 min) + rotating refresh tokens (30 days, revoke-all support)**; keep bearer-JWT shape so the existing `sync-client.ts` patterns evolve rather than rewrite.
- `users` schema evolution (additive migration on the Postgres side): `id`, `email` (citext unique), `password_hash`, `created_at`, `status` (`active|deletion_pending|deleted`), `subscription_tier` (retained for display; not the authority), `marketing_opt_in`. **Entitlements live in a separate grants store owned by proposal 5's schema work but read via `GET /v1/entitlements` (contract here):** `{ plan, capabilities: Record<CapabilityId, {enabled, reason?}>, quotas: Record<CapabilityId, QuotaState>, expiresAt }`.
- Sign-in with Apple / Google (OAuth) as optional secondary providers behind the same account record (fills the `oauth.ts` 501 stub; needed for App Store sign-in compliance — see proposal 23). Web+desktop+mobile flows via `plethora://` deep link (desktop/mobile) and `localhost:15173/auth/callback` (web/dev), reusing `routes/auth-callback.tsx`.

### 2. Device identity & sessions
- `devices` table: `id`, `user_id`, `device_name`, `platform`, `public_key` (per-device keypair), `created_at`, `last_seen`, `revoked_at`. Each app install generates an Ed25519 keypair (stored in the Rust AuthStore); sessions bind to a device. Device list UI ("Devices" in settings) with revoke action (proposal 6's sync uses the same registry).
- Session records server-side (hashed refresh tokens) enabling logout-everywhere and revocation propagation.

### 3. Client auth layer (Rust-first)
- New `src-tauri/src/plethora_auth/`: account state (signed-out default), token storage via existing AuthStore patterns (new keyring service `com.plethora.app.account` + encrypted-file fallback), automatic refresh-on-401 with single-flight, clock-skew handling (server `Date` header), offline queue-free design (auth failures never block local features).
- Commands: `account_get_state`, `account_sign_in(email,password)`, `account_sign_in_oauth(provider)`, `account_sign_out(localOnly: bool)`, `account_refresh`, `account_list_devices`, `account_revoke_device(id)`, `account_delete_request()` (deletion flow owned by proposal 22 — command only links).
- **`accountLink` in TS**: `src/stores/accountStore.ts` consumes commands; `sync-client.ts` legacy login/register deprecated (removed after migration window). Local user data is keyed by local profile only — signing out removes cloud tokens but never local documents (test-proven).

### 4. Entitlement wiring
- Implements `entitlement_refresh` (contract from proposal 2): on sign-in, on focus, post-billing events; publishes `entitlements-changed` Tauri event; anonymous users never trigger network calls from the auth layer.

### 5. Account switching
- Single active account; "switch account" = sign-out(localOnly: true keeps data) + sign-in. Local data is not partitioned per-account in v1 (documented limitation; collections remain the local partitioning mechanism) — flagged as a product decision for multi-profile later.

## Impact

### Affected Specs
- `plethora-accounts` — New (auth flows, token lifecycle, device registry, optional-account invariant).

### Affected Code Areas
- Server: `server/src/routes/auth.ts` (rewrite), `oauth.ts` (implement), `db/schema.ts` (additive), `middleware/auth.ts` (refresh/revocation). Proposal 5 owns service framework/deployment.
- App: new `src-tauri/src/plethora_auth/`; `src/stores/accountStore.ts`; `entitlements/mod.rs` (refresh impl); `UserProfilePanel.tsx` (real account surface); `LoginModal.tsx` (evolve or replace); i18n 6 locales.

### Non-goals
- No billing (proposal 4), no sync (proposal 6), no account deletion execution (proposal 22), no multi-profile local partitioning, no social features.

## Dependencies

### Hard dependencies
- Proposal 2 (snapshot/capability contract), rebrand (names/prefixes/keyring services).

### Soft dependencies
- Proposal 5's service skeleton (this change can build against a locally-run server; endpoints are contract-first).

### May run concurrently
- Proposals 4, 5 (after each owns its interfaces), 21 (UX consumes account state late).

### Must not start yet
- Proposals 6, 17–20 (need real auth), 23 (needs complete flows).

## Shared interfaces (owned here)
- `/v1/auth/*`, `/v1/entitlements` (GET), account/device command surface, `accountStore` + `plethora_auth` Rust module, `entitlements-changed` event, per-device keypair API used by proposal 6.

## Ownership boundaries
- **May modify**: `server/src/routes/{auth,oauth}.ts`, auth middleware, account UI components, `plethora_auth/`, entitlement refresh implementation.
- **Must treat as external**: entitlement resolution semantics (proposal 2), service infra/middleware/rate-limits (proposal 5), billing routes (proposal 4), sync crypto (proposal 6).

## Collision risks
- `server/src/middleware/auth.ts` + `db/schema.ts` (also touched by 5): coordinate via contract-first commits. `UserProfilePanel.tsx` (also touched by 21): this change owns structural account surface; 21 owns upgrade/marketing surfaces within it.
- `entitlements/mod.rs`: only the refresh implementation (proposal 2 owns the rest).

## Integration contract
- Exposes `GET /v1/entitlements` shaped exactly as proposal 2's `EntitlementSnapshot`; auth errors use `401 + code=token_expired` (client auto-refreshes once) and `401 + code=session_revoked` (forces signed-out state, local data untouched).

## Testing & acceptance

### Tests
- Server: register/login/refresh/rotation/reuse-detection (rotated refresh token reuse revokes family), logout-everywhere, device revoke propagation, OAuth stub replaced with provider-adapter tests (mock IdPs).
- Rust: token persistence + auto-refresh single-flight under concurrent 401s; clock-skew tolerance; keypair generation; offline sign-in state preservation.
- TS: accountStore state machine; **sign-out preserves local library** (integration test over documentStore/reviewStore); anonymous cold-start performs zero auth network calls.
- Security: tokens never logged (extend existing log-hygiene tests), no token in URLs (deep-link payloads carry one-time codes exchanged server-side, never tokens).

### Acceptance criteria
- Sign-in on desktop persists across restarts without re-prompt; revoked device's refresh fails within one refresh cycle; entitlement snapshot updates after sign-in; app remains fully usable signed-out and offline.

### Must remain unchanged
- All local functionality signed-out; existing cloud-backup OAuth flows (separate AuthStore namespace) unaffected.

## Open questions
1. Email verification requirement (v1 assumes verified-only for cloud features? product decision).
2. Username-vs-email-only identity; password reset email infra (needs mail provider decision — proposal 5 deployment).
3. Whether web (readsync.org-successor) and desktop share one account pool (assumed yes).
