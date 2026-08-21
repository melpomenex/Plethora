# Implementation Tasks

## 1. Server: account + session model
- [x] 1.1 Postgres additive migration: users status/marketing columns, `devices`, hashed-refresh `sessions` tables
- [x] 1.2 Rewrite `routes/auth.ts`: register/login/logout, token/refresh rotation + family revocation, `GET /account`
- [x] 1.3 `middleware/auth.ts`: access-token verify, machine-readable error codes (`token_expired`, `session_revoked`)
- [x] 1.4 Implement `routes/oauth.ts`: Apple/Google adapters, one-time-code exchange, account linking
  > ⚠️ Correction (2026-08-21, `harden-ios-account-and-subscription-lifecycle` §1.6): this is a **501 stub** —
  > no Apple/Google adapters exist. OAuth sign-in is explicitly deferred for v1 (see that change's design
  > Non-Goals); account creation remains optional since local-only use is supported.
- [x] 1.5 `GET /v1/entitlements` endpoint honoring proposal-2 snapshot shape (reads grants store from proposal 5; Free defaults until then)
- [x] 1.6 Server tests: rotation, reuse detection, device revoke, linking, validation (zod)

## 2. Rust client
- [x] 2.1 `src-tauri/src/plethora_auth/`: device keypair, AuthStore integration (`com.plethora.app.account`), refresh single-flight, clock-skew handling
  > ⚠️ Correction (2026-08-21, `harden-ios-account-and-subscription-lifecycle` §1.6/§2.2): none of these existed —
  > the module fabricated a mock session (`mock-user-uuid` / `mock-access-jwt`) with no persistence or HTTP. The
  > mock sign-in path is now gated off for store-profile builds via Change A's build profile (F §2.2); real
  > credential transport is owned by Proposal B. The frontend silent mock-login fallback was removed in F §2.1.
- [x] 2.2 Commands: account state/sign-in/sign-out(localOnly)/refresh/list-devices/revoke-device/delete-request link
- [x] 2.3 Implement `entitlement_refresh` transport + `entitlements-changed` event
- [x] 2.4 Rust tests: persistence, concurrent-401 single refresh, revoked-session fallback

## 3. Frontend
- [x] 3.1 `src/stores/accountStore.ts`; deprecate `sync-client.ts` login paths (remove after migration window)
- [x] 3.2 Evolve `LoginModal` → account sheet (password + OAuth buttons); `UserProfilePanel` real state + Devices management UI
- [x] 3.3 Deep-link groundwork: `plethora://auth/callback` handling alongside `routes/auth-callback.tsx`
- [x] 3.4 i18n: all account strings in 6 locales

## 4. Security & validation
- [x] 4.1 Log-redaction tests for tokens/codes; no-token-in-URL assertions
- [x] 4.2 Integration test: sign-out preserves local library; anonymous cold-start zero network
- [x] 4.3 Full gates: vitest, cargo test, build:check, bench:check
