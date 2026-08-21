## Why

Older OpenSpec documentation claims StoreKit 2 billing is complete; the live code proves otherwise. Verified reality:

- `src-tauri/plugins/` contains only `plethora-android-genai`, `plethora-android-tts`, `plethora-folder-import`. **No StoreKit plugin exists** — no Swift, no Rust registration, no Cargo wiring.
- `src/lib/billing/types.ts` defines a `BillingProvider` interface and a `MockBillingProvider` with hard-coded `$9.99/month` / `$79.99/year` products; **it is the only implementation in the repo**. `billingStore.ts` hard-wires the mock at module scope; `setProvider()` is never called by app code; `billingStore.init()` is never called at startup.
- `PaywallModal.tsx` falls back to a hard-coded `$12/month` when no products load (which is always, since `init()` never runs).
- Server-side, `POST /v1/billing/validate` **ignores `receiptData` entirely**, fabricates a renewal date, and blindly sets `subscription_tier='pro'` for anyone authenticated. `POST /v1/billing/webhooks/:provider` does event dedupe but **zero signature verification** — no App Store Server Notifications v2 (`signedPayload`/JWS) parsing exists anywhere.
- The Rust `entitlement_refresh` command never contacts the server (re-stamps a local timestamp); the client never calls `/v1/billing/validate`. There is no trusted path from a store purchase to a Pro entitlement.
- `implement-cross-platform-subscription-billing-and-license-management/tasks.md` marks StoreKit/Play plugins (2.1/2.2), App Store Server API JWS verification (3.2), webhook signature verification (3.4), grant derivation (3.5/3.6), and the purchase intent path (4.1) as `[x]`. **All of those are false** and must be corrected.

Apple requires real StoreKit 2 commerce, working Restore Purchases, and accurate subscription behavior for any app offering subscriptions. Shipping the mock would be an instant rejection and a commercial failure.

## What Changes

- Implement a native iOS StoreKit 2 billing provider as a new Tauri mobile plugin (`src-tauri/plugins/plethora-storekit`), exposing product query, purchase, transaction verification, entitlements, transaction updates, restore, and manage-subscription through the existing `BillingProvider` interface.
- Wire provider selection at startup: iOS uses the native provider; desktop/web keep explicit, clearly-labeled mock behavior for development only.
- Add an architectural invariant: a production (`store` profile) iOS build MUST fail if `MockBillingProvider` is the active backend; mock products/prices MUST NOT render for real App Store products (localized pricing from StoreKit is the single source of truth).
- Harden the server: real App Store transaction (JWS) verification via the App Store Server API / on-device `Transaction.unverified` data as appropriate, signed App Store Server Notifications v2 handling, grant derivation, reconciliation, and refund/revocation handling. Replace the trust-on-first-POST validate endpoint.
- Bind Apple transactions to Plethora accounts (`appAccountToken`), support relaunch reconciliation, offline/cached entitlements with grace, and sandbox testing via a StoreKit configuration file / test plan.

## Capabilities

### New Capabilities

- `ios-storekit-billing`: Native StoreKit 2 purchase, restore, entitlement, and subscription-management behavior on iOS.
- `store-entitlement-validation`: Server-side verification of store transactions and derivation/revocation of Plethora entitlements from verified Apple data.

### Modified Capabilities

None.

## Impact

- New: `src-tauri/plugins/plethora-storekit/**` (Rust + Swift), StoreKit configuration/test-plan files.
- `src/lib/billing/` (new `appStoreProvider.ts`; types extended carefully — keep `MockBillingProvider` for dev), `src/stores/billingStore.ts` (startup init + provider selection), `src/components/monetization/PaywallModal.tsx` (real product rendering, remove `$12/month` fallback), `src/main.tsx` (init call).
- Server: `server/src/routes/v1/billing.ts` (rewrite validate/webhooks), new App Store Server API client module, DB additions (transaction tables) with migration.
- `src-tauri/src/lib.rs` + `Cargo.toml`: plugin registration (narrow, coordinated diff — see ownership).
- Tests: provider unit tests, server JWS verification tests, invariant tests, sandbox manual plan.

**Owns:** everything above.
**Must NOT change:** entitlement capability registry semantics (`src/types/entitlements.ts` read-only consumption), account lifecycle UX (Proposal F owns subscription management screens' surrounding UX; B owns the billing data + manage-subscription deep link), build pipeline (A), privacy disclosures (C consumes B's data-flow facts).

## Dependencies

- **Hard:** none at code level — B can start immediately against the existing `BillingProvider` interface and A's `buildProfile.ts` export signature (coordinate the constant name; if A hasn't landed, B defines the agreed signature in place and A adopts it).
- **Soft:** A's plugin scaffolding conventions and `gen/apple` for device testing; F consumes B's billing events for lifecycle UX; G runs B's sandbox scenarios as evidence.

## Parallelization Notes

B is fully parallel with C, D, E. The only shared-file risk is `src-tauri/src/lib.rs` / `Cargo.toml` plugin registration (A and B both may touch): B adds a self-contained plugin crate and a single registration line guarded `#[cfg(target_os = "ios")]`; merge conflicts are one-line and trivially resolvable — last writer wins with both registrations present.

## Migration / Backward Compatibility

- `BillingProvider` interface preserved; `MockBillingProvider` remains for development/web but is never active under the store profile.
- Server: existing `purchases` table rows from the unverified era cannot be trusted; migration policy documented (treat as unverified, re-derive from Apple on first reconciliation).
- Users who "purchased" against the mock in dev builds lose that fake state in production — intended and documented.

## Risks

- StoreKit 2 + Tauri 2 mobile plugin IPC is novel for this repo; Swift/Rust async bridging needs care (use the folder-import plugin as the structural template).
- App Store Server API requires server credentials (In-App Purchase key, issuer ID, key ID) — secrets protocol must be defined; without them, server verification can run in a documented degraded mode for sandbox only, never production.
- Subscription lifecycle edge cases (billing retry, grace, revocation) are easy to get subtly wrong; the spec's scenario list is the contract.
