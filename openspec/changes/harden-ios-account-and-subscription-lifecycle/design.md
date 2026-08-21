## Context

### Verified current state

**Server (real):** `POST /v1/auth/register|login|token/refresh|logout`, `GET /v1/auth/account`, device list/revoke; refresh rotation with family revocation on reuse detection; login rejects accounts with `status='deleted'`; tests exist (`authAndJobs.test.ts`). `DELETE /v1/auth/account` (line ~343): synchronous cascade over 12+ tables including `purchases`; returns `{success}`. `GET /v1/auth/export`: user/devices/inbox/tokens/webhooks JSON — narrow but real. OAuth routes: 501 stubs.

**Frontend:** `accountStore.ts` calls real endpoints for sign-in/up/out, but `signIn` catches network errors and **falls back to a mock session (`dev-token`)** at lines 92-106. Deletion UX in `SettingsPage.tsx` (~1674-1779): single `modal.confirm` titled "Delete Account & Erase Cloud Data?"; on fetch failure it still signs out locally with an ambiguous toast — server account survives silently. Copy asserts "cascade-wipe all cloud databases across all 12 tables" and "App Store Guideline 5.1.1(v) Compliant".

**Rust:** `plethora_auth` mock (`mock-user-uuid`, fabricated JWTs) registered via commands at `lib.rs:2242-2247`; no persistence/HTTP.

**Subscription UX:** none — no status display, no restore button, no manage-subscription link anywhere; `billingStore.restore()` uncalled by UI. Trial state is cosmetic and unenforced.

### Stale claims (verified false)

- `implement-plethora-accounts-authentication-and-entitlements/tasks.md`: 1.4 `[x]` (OAuth adapters — actually 501 stubs); 2.1 `[x]` (device keypair/AuthStore/single-flight/clock-skew — absent); parts of 2.2/2.3.
- `implement-plethora-cloud-privacy-security-data-export-and-account-deletion/tasks.md`: 2.1 `[x]` (retention schedule + verification job + deletion receipt — absent); 2.2 partial (multi-step flow — actually one confirm).

## Goals / Non-Goals

**Goals:**

- A reviewer can discover, execute, and verify account deletion in-app within minutes, with accurate outcomes.
- Deletion success/failure is unambiguous; failures are retryable and never masquerade as success.
- Subscription lifecycle UX (status, restore, manage, loss-of-entitlement) built on B's engine.
- Sign-in never fabricates sessions; offline sign-in fails honestly.
- Delete-account ≠ cancel-Apple-subscription, communicated clearly where it matters.

**Non-Goals:**

- Rewriting working server auth (rotation/revocation stay).
- Implementing StoreKit (B), privacy disclosures (C), gating (D).
- OAuth Apple sign-in for v1 (documented deferral; note Guideline implications if account creation is ever required — currently optional since local-only use remains supported).
- Local data wipe on account deletion (current product model keeps local library; copy already states this — preserve).

## Decisions

### 1. Deletion flow redesign
Multi-step in a dedicated component: (1) entry in Settings → Account (and linked from Privacy tab) with plain-language description of exactly what is deleted (cloud data, sync, devices, tokens) and what remains (local files, Apple subscription billing); (2) export offer wired to `GET /v1/auth/export` before confirmation; (3) typed/explicit confirmation; (4) call API; (5) outcome states: success → signed out with accurate confirmation + reminder to cancel Apple subscription if subscribed (deep link when B's manage-subscription action exists); failure → explicit error, retry option, remain signed in. Remove the silent sign-out-on-failure path.

### 2. Subscription-aware deletion copy
When entitlement store reports active/grace subscription: deletion dialog adds "Your Plethora account will be deleted, but your Apple subscription continues until cancelled in Apple Settings. [Manage Subscription]" — using B's `storekit_manage_subscriptions` action. Never imply Apple billing stops.

### 3. Subscription lifecycle UX
In `UserProfilePanel` (+ Settings Account section): plan status (Free/Pro + renewal date from B's verified snapshot), grace/billing-issue state, Restore Purchases button (spinner/result states), Manage Subscription action (iOS). Entitlement-loss presentation (expired/refunded): downgrade notice with resubscribe path to paywall. All consuming B's stores read-only.

### 4. Sign-in integrity
Remove the offline mock-login fallback: network errors surface as errors with retry; no session is created without server verification. Keep genuine offline *usage* of previously-signed-in state intact. Production builds must not contain the Rust mock sign-in path (cfg/build-profile gate; coordinate the exact mechanism with A's build profile so B/D consume consistently).

### 5. Post-deletion device behavior
On confirmed deletion: local session cleared, sync disabled cleanly, app continues in local-only mode (product model preserved), stale tokens on other devices fail naturally at next refresh (server-side cascade already revokes). Document the expected second-device experience.

### 6. Transaction-record coordination
B's migration introduces retained minimal transaction records; F verifies the deletion flow's copy accurately describes what is retained ("transaction records required for accounting/refunds are retained") and that the combined cascade + retention behaves per B's `store-entitlement-validation` spec.

## Data Flows

Deletion: client → `DELETE /v1/auth/account` (bearer) → cascade → response. Export: `GET /v1/auth/export` → download. Subscription reads: B's plugin/store → UI. No new persistence.

## Failure Behavior

- Deletion API timeout/5xx: explicit error state, retry affordance, session retained.
- Refresh failure mid-session (deleted elsewhere): clean transition to signed-out local mode with explanation on next authed action.

## UX States

Documented for: anonymous/local, signed-in free, Pro active, Pro grace, expired/downgraded, deletion modal steps ×(subscribed | not subscribed), deletion success, deletion failure, post-deletion relaunch, second-device post-deletion.

## Testing Strategy

- Unit: deletion component states; accountStore error paths (no mock fallback); subscription-status rendering from fixture snapshots.
- Server: extend deletion test for explicit failure semantics; deleted-account login rejection already tested — keep green.
- Integration/manual: full scenario matrix (create → upgrade sandbox → restore → delete → login rejected; second-device propagation; export-before-delete). G converts to evidence runs.

## Rollout

Deletion rewrite + fallback removal independent of B (Wave 1 allowed); subscription UX integrates when B lands (Wave 2). Server changes are backward-compatible additions.

## Alternatives Considered

- Blocking deletion while subscribed: rejected — hostile UX and review-risky; warn + deep-link instead.
- Immediate token invalidation push to other devices: deferred — natural refresh-rejection suffices for v1; documented.

## Rejected Alternatives / Notes

- Deleting local library on cloud deletion: rejected — contradicts local-first product promise; copy makes the split explicit.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| Deletion flow component + copy, account section of SettingsPage, UserProfilePanel | **F** | C owns privacy-tab content beside it; D gates availability only |
| `accountStore.ts` sign-in integrity | **F** | B consumes account state read-only |
| `src-tauri/src/plethora_auth` mock gating | **F** (mechanism coordinated with A's build profile) | B owns `entitlements/mod.rs` |
| Server deletion semantics tweaks | **F** | cascade schema changes belong to B's migration |
