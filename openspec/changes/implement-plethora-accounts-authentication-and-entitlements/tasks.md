# Implementation Tasks

## 1. Server: account + session model
- [ ] 1.1 Postgres additive migration: users status/marketing columns, `devices`, hashed-refresh `sessions` tables
- [ ] 1.2 Rewrite `routes/auth.ts`: register/login/logout, token/refresh rotation + family revocation, `GET /account`
- [ ] 1.3 `middleware/auth.ts`: access-token verify, machine-readable error codes (`token_expired`, `session_revoked`)
- [ ] 1.4 Implement `routes/oauth.ts`: Apple/Google adapters, one-time-code exchange, account linking
- [ ] 1.5 `GET /v1/entitlements` endpoint honoring proposal-2 snapshot shape (reads grants store from proposal 5; Free defaults until then)
- [ ] 1.6 Server tests: rotation, reuse detection, device revoke, linking, validation (zod)

## 2. Rust client
- [ ] 2.1 `src-tauri/src/plethora_auth/`: device keypair, AuthStore integration (`com.plethora.app.account`), refresh single-flight, clock-skew handling
- [ ] 2.2 Commands: account state/sign-in/sign-out(localOnly)/refresh/list-devices/revoke-device/delete-request link
- [ ] 2.3 Implement `entitlement_refresh` transport + `entitlements-changed` event
- [ ] 2.4 Rust tests: persistence, concurrent-401 single refresh, revoked-session fallback

## 3. Frontend
- [ ] 3.1 `src/stores/accountStore.ts`; deprecate `sync-client.ts` login paths (remove after migration window)
- [ ] 3.2 Evolve `LoginModal` → account sheet (password + OAuth buttons); `UserProfilePanel` real state + Devices management UI
- [ ] 3.3 Deep-link groundwork: `plethora://auth/callback` handling alongside `routes/auth-callback.tsx`
- [ ] 3.4 i18n: all account strings in 6 locales

## 4. Security & validation
- [ ] 4.1 Log-redaction tests for tokens/codes; no-token-in-URL assertions
- [ ] 4.2 Integration test: sign-out preserves local library; anonymous cold-start zero network
- [ ] 4.3 Full gates: vitest, cargo test, build:check, bench:check
