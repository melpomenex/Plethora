## Why

The account backend is real and tested — `server/src/routes/v1/auth.ts` implements register/login/refresh-with-reuse-revocation/logout/devices, and `DELETE /v1/auth/account` performs a genuine cascade across sessions, devices, tokens, webhooks, inbox items, sync records, usage, grants, quotas, purchases, jobs, and the user row. The frontend has `accountStore`, `LoginModal`, `UserProfilePanel`, and a Settings deletion flow. But the end-to-end iOS lifecycle has verified gaps that matter for App Review (Guidelines 3.1.2, 5.1.1(v), 5.1.1(d)) and for real users:

- **Deletion failure is silent:** the Settings deletion handler signs the user out even when the server call fails — the toast says "Account and cloud data permanently deleted" on success but "Account signed out and local session cleared" on failure, leaving the account alive with no user-visible error or retry. The copy claims "App Store Guideline 5.1.1(v) Compliant" on the strength of a single `modal.confirm`.
- **Deletion vs. subscription conflation:** nothing distinguishes "delete Plethora account" from "cancel Apple subscription." A user with an active StoreKit subscription who deletes their account gets no warning that Apple billing continues until cancelled separately.
- **No subscription management UX at all:** zero "manage subscription"/"cancel" surfaces; no Restore Purchases button anywhere; renewal date/status never shown. `billingStore.restore()` is test-only.
- **Rust auth is a mock:** `plethora_auth` fabricates `mock-user-uuid`/`mock-access-jwt`; `entitlement_refresh` never contacts the server (B fixes the transport); the frontend `signIn` **silently falls back to a mock login on network error** (`accountStore.ts:92-106`) — an offline user believes they're signed in.
- **Stale/false claims:** `implement-plethora-accounts-authentication-and-entitlements/tasks.md` 1.4 (OAuth adapters) is a 501 stub marked `[x]`; 2.1 (device keypair, refresh single-flight) marked `[x]` but absent; `implement-plethora-cloud-privacy-security-data-export-and-account-deletion/tasks.md` 2.1 (retention schedule, deletion receipt, verification job) and 2.2 (multi-step deletion flow) marked `[x]` but absent.

## What Changes

- Harden the account deletion flow: accurate multi-step confirmation, real success/failure distinction with retry, post-deletion state handling, export-before-delete offer (wired to the existing `GET /v1/auth/export`), and copy that explicitly separates deleting the Plethora account from cancelling an Apple subscription (with a direct path to Apple's manage-subscription when a subscription is active).
- Build the subscription lifecycle UX on Proposal B's billing engine: status display (plan, renewal, grace), Restore Purchases entry, manage-subscription deep link, entitlement-loss handling across relaunch/second device.
- Fix authentication integrity: remove the silent mock-login fallback; surface offline sign-in failure honestly; ensure token refresh/logout/multi-device behavior is correct on iOS (Rust mock removal scoped: B owns the entitlement transport; F owns the sign-in/out UX path and the mock fallback removal).
- Verify the complete reviewer-facing lifecycle: create → use → upgrade → restore → delete, including post-deletion login rejection (server already rejects `status='deleted'`) and synced-device behavior.
- Coordinate with B on transaction-record retention: deletion keeps minimal accounting records per B's `store-entitlement-validation` spec; F owns communicating this in UX copy and verifying the cascade respects it.

## Capabilities

### New Capabilities

- `ios-account-lifecycle`: End-to-end account creation, authentication, subscription UX coordination, deletion, and post-deletion behavior on iOS.

### Modified Capabilities

None.

## Impact

- `src/components/settings/SettingsPage.tsx` account/privacy sections (deletion flow rewrite — coordinate section ownership with C/D), `src/stores/accountStore.ts` (remove mock fallback), `UserProfilePanel.tsx` (subscription status/restore entries consuming B's store), new deletion-confirmation component.
- Server: minor — deletion response semantics (explicit success/failure), optional deletion receipt; no auth rewrite.
- `src-tauri/src/plethora_auth`: remove/gate the mock sign-in path for production builds (contained change; coordinate with B who owns `entitlements/mod.rs`).
- Docs: lifecycle runbook consumed by G.

**Owns:** account/subscription UX surfaces, deletion flow, sign-in integrity, lifecycle scenarios.
**Must NOT change:** billing engine internals (B), entitlement registry semantics, privacy disclosures content (C), capability gating mechanics (D).

## Dependencies

- **Hard:** B for subscription status/restore/manage-subscription data (interfaces defined in B's spec; F can build against the contract in parallel and integrate when B lands).
- **Soft:** C for disclosure copy adjacency; G consumes F's scenario matrix as evidence runs; D gates the surfaces' availability.

## Parallelization Notes

Wave 2 by preference, but the deletion-flow rewrite and mock-fallback removal have no B dependency and can start in Wave 1. Collision points: `SettingsPage.tsx` (C: privacy tab; D: update row) — F confines edits to the account section; `UserProfilePanel.tsx` is F-owned for this initiative.

## Migration / Backward Compatibility

No API breaking changes. Deletion flow becomes multi-step — strictly additive confirmation. Mock-fallback removal changes behavior only in the error path (previously misleading).

## Risks

- Deletion + active subscription is the highest-risk review scenario; the copy and flow must be exact.
- Server cascade already deletes `purchases` rows — B's retention requirement (minimal transaction records) may require a cascade adjustment; that schema change belongs to B's migration; F verifies and documents the combined behavior.
