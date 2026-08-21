## 1. Plugin Scaffolding

- [ ] 1.1 Create `src-tauri/plugins/plethora-storekit/` mirroring `plethora-folder-import` structure: Cargo.toml (crate name `plethora-storekit`, matching `links`), permissions, build.rs; SwiftPM package named `plethora-storekit` exporting `@_cdecl("init_plugin_plethora_storekit")`; Rust `ios_plugin_binding!` + `register_ios_plugin`. Non-iOS targets return typed unsupported errors for every command.
- [ ] 1.2 Register the plugin in `src-tauri/src/lib.rs` (single `#[cfg(target_os = "ios")]`-compatible registration) and add the dependency in `src-tauri/Cargo.toml`. Keep this diff to two lines plus imports.
- [ ] 1.3 Verify the plugin loads on an iOS simulator (products query returns empty-but-successful without a StoreKit configuration); record evidence.

## 2. Product Query and Localized Pricing

- [ ] 2.1 Swift: implement `storekit_get_products(ids)` via `Product.products(for:)`; map to `{ id, displayName, description, priceFormatted (localized), period, introOffer? }`. No price strings authored anywhere in repo code.
- [ ] 2.2 Define product identifiers as constants shared by app + StoreKit configuration file (`plethora_pro_monthly`, `plethora_pro_annual`) — ids only, never prices.
- [ ] 2.3 Create a committed StoreKit configuration file and (if adopted) test plan for sandbox/local testing.

## 3. Purchase Pipeline

- [ ] 3.1 Swift: `storekit_purchase(product_id, app_account_token)` using `Product.purchase(options:)` with `.appAccountToken(uuid)`; map outcomes to `purchased | pending | userCancelled | failed(reason)`; return the verified transaction payload including the signed JWS string.
- [ ] 3.2 Swift: verification — any `VerificationResult.unverified` is treated as failure; verified results extract originalTransactionId, transactionId, productId, expirationDate, revocationDate, environment.
- [ ] 3.3 Frontend: new `src/lib/billing/appStoreProvider.ts` implementing `BillingProvider` over the plugin commands; extend result types for pending/cancelled states without breaking the existing interface.
- [ ] 3.4 Wire `billingStore.init()` into startup (`src/main.tsx`): iOS → AppStoreBillingProvider; other platforms → mock with dev-only labeling. Unit tests for selection logic.

## 4. Entitlements, Updates, Restore

- [ ] 4.1 Swift: `storekit_current_entitlements()` iterating `Transaction.currentEntitlements` with verification; `storekit_restore()` wrapping `AppStore.sync()`; `storekit_start_transaction_listener()` emitting `plethora-storekit-transaction-update` events from `Transaction.updates`.
- [ ] 4.2 Frontend: consume transaction-update events → refresh entitlement snapshot + notify server for reconciliation; relaunch reconciliation (on init, post any pending/unverified transactions to server).
- [ ] 4.3 Swift: `storekit_manage_subscriptions()` opening Apple's manage-subscription sheet; expose through billing store for Proposal F's UI.
- [ ] 4.4 Offline/grace: cached entitlement behavior per design §5 (grace keeps Pro with visible billing-issue state; hard expiry downgrades). Tests for each state transition.

## 5. Mock Firewall Invariant

- [ ] 5.1 Test: under `__PLETHORA_BUILD_PROFILE__ === 'store'`, activating `MockBillingProvider` throws; a store-profile check asserts active provider type is `appstore` on iOS.
- [ ] 5.2 Remove the `$12/month` hard-coded fallback in `PaywallModal.tsx`; products failing to load render a retry state. Add a source-scan test asserting no literal currency-formatted product prices exist in monetization components.
- [ ] 5.3 Label mock provider surfaces as development-only so dev builds are unambiguous.
- [ ] 5.4 **Documentation correction:** annotate the false `[x]` tasks (2.1, 2.2, 3.2, 3.4, 3.5, 3.6, 4.1) in `openspec/changes/implement-cross-platform-subscription-billing-and-license-management/tasks.md` as superseded by this change.

## 6. Server Verification

- [ ] 6.1 Add App Store Server API client module: JWT-signed requests, env config (`APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY`), documented secrets protocol.
- [ ] 6.2 Rewrite `/v1/billing/validate` → verify signed transaction JWS (Apple root cert chain, bundle id, expiry, revocation, environment); reject anything unverifiable. Fixture-based tests: valid / expired / revoked / wrong bundle-id / tampered payloads.
- [ ] 6.3 Migration: new `store_transactions` table keyed by `original_transaction_id`; policy for pre-existing unverified `purchases` rows (mark unverified, re-derive on first reconciliation).
- [ ] 6.4 Grant derivation: Pro tier derives ONLY from verified non-expired non-revoked transactions mapped via `appAccountToken` → user; anonymous purchases bind at next sign-in. Tests for the derivation matrix.
- [ ] 6.5 ASNS v2 endpoint: verify `signedPayload` JWS; handle SUBSCRIPTION_RENEWED / EXPIRED / REFUND / REVOKE / GRACE_PERIOD / BILLING_RECOVERY / DID_CHANGE_RENEWAL_STATUS; idempotent by notification identity. Signature-mismatch and replay tests.
- [ ] 6.6 Update `/v1/billing/subscriptions` + `/v1/billing/restore` to read verified data only.
- [ ] 6.7 Implement real server fetch in Rust `entitlement_refresh` (contained change in `src-tauri/src/entitlements/mod.rs`); keep existing cache/TTL/grace tests green; add a transport test.

## 7. Sandbox Verification

- [ ] 7.1 Document the sandbox scenario matrix (purchase monthly, purchase annual, cancel, refund, ask-to-buy pending, restore on second device, relaunch persistence, grace) in `docs/release/ios-billing-sandbox.md`.
- [ ] 7.2 **Verification:** execute the matrix against App Store Connect sandbox testers on physical devices; record transactions ids/results as evidence for Proposal G. Levels required: simulator verified (local StoreKit config) AND physical-device sandbox verified.
