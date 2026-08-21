# Implementation Tasks

> Status notes (2026-08-21): implemented on a host without an Xcode SDK —
> Swift was written against the StoreKit 2 API and reviewed carefully but has
> NOT been compiled; Rust verified with `cargo check -p plethora-storekit`
> (host target; the aarch64-apple-ios check is blocked by the missing
> iphoneos SDK, not by plugin code). §7.2 execution is open pending physical
> device + App Store Connect access.

## 1. Plugin Scaffolding

- [x] 1.1 Create `src-tauri/plugins/plethora-storekit/` mirroring `plethora-folder-import` structure: Cargo.toml (crate name `plethora-storekit`, matching `links`), permissions, build.rs; SwiftPM package named `plethora-storekit` exporting `@_cdecl("init_plugin_plethora_storekit")`; Rust `ios_plugin_binding!` + `register_ios_plugin`. Non-iOS targets return typed unsupported errors for every command.
- [x] 1.2 Register the plugin in `src-tauri/src/lib.rs` (single registration; the crate compiles on all targets so non-iOS invocations hit the typed UNSUPPORTED errors) and add the dependency in `src-tauri/Cargo.toml`. Plus one `plethora-storekit:default` capability line.
- [ ] 1.3 Verify the plugin loads on an iOS simulator (products query returns empty-but-successful without a StoreKit configuration); record evidence. — *blocked: no Xcode SDK on the implementation host; first simulator/device session should confirm.*

## 2. Product Query and Localized Pricing

- [x] 2.1 Swift: implement `storekit_get_products(ids)` via `Product.products(for:)`; map to `{ id, displayName, description, priceFormatted (localized), period, introOffer? }`. No price strings authored anywhere in repo code. *(Swift not compiled here — see header note.)*
- [x] 2.2 Define product identifiers as constants shared by app + StoreKit configuration file (`plethora_pro_monthly`, `plethora_pro_annual`) — ids only, never prices. (`src/lib/billing/productIds.ts` ↔ `StoreKitPlugin.swift`.)
- [x] 2.3 Create a committed StoreKit configuration file and (if adopted) test plan for sandbox/local testing. (`PlethoraProducts.storekit` committed; a separate `.xctestplan` was not adopted — the scenario matrix in `docs/release/ios-billing-sandbox.md` serves as the plan.)

## 3. Purchase Pipeline

- [x] 3.1 Swift: `storekit_purchase(product_id, app_account_token)` using `Product.purchase(options:)` with `.appAccountToken(uuid)`; map outcomes to `purchased | pending | userCancelled | failed(reason)`; return the verified transaction payload including the signed JWS string. *(Swift not compiled here.)*
- [x] 3.2 Swift: verification — any `VerificationResult.unverified` is treated as failure; verified results extract originalTransactionId, transactionId, productId, expirationDate, revocationDate, environment. *(Swift not compiled here.)*
- [x] 3.3 Frontend: new `src/lib/billing/appStoreProvider.ts` implementing `BillingProvider` over the plugin commands; extend result types for pending/cancelled states without breaking the existing interface.
- [x] 3.4 Wire `billingStore.init()` into startup (`src/main.tsx`): iOS → AppStoreBillingProvider; other platforms → mock with dev-only labeling. Unit tests for selection logic.

## 4. Entitlements, Updates, Restore

- [x] 4.1 Swift: `storekit_current_entitlements()` iterating `Transaction.currentEntitlements` with verification; `storekit_restore()` wrapping `AppStore.sync()`; `storekit_start_transaction_listener()` emitting `plethora-storekit-transaction-update` events from `Transaction.updates`. *(Swift not compiled here; events flow over the plugin's channel-listener mechanism.)*
- [x] 4.2 Frontend: consume transaction-update events → refresh entitlement snapshot + notify server for reconciliation; relaunch reconciliation (on init, post any pending/unverified transactions to server).
- [x] 4.3 Swift: `storekit_manage_subscriptions()` opening Apple's manage-subscription sheet; expose through billing store for Proposal F's UI.
- [x] 4.4 Offline/grace: cached entitlement behavior per design §5 (grace keeps Pro with visible billing-issue state; hard expiry downgrades). Tests for each state transition.

## 5. Mock Firewall Invariant

- [x] 5.1 Test: under `__PLETHORA_BUILD_PROFILE__ === 'store'`, activating `MockBillingProvider` throws; a store-profile check asserts active provider type is `appstore` on iOS.
- [x] 5.2 Remove the `$12/month` hard-coded fallback in `PaywallModal.tsx`; products failing to load render a retry state. Add a source-scan test asserting no literal currency-formatted product prices exist in monetization components.
- [x] 5.3 Label mock provider surfaces as development-only so dev builds are unambiguous.
- [x] 5.4 **Documentation correction:** annotate the false `[x]` tasks (2.1, 2.2, 3.2, 3.4, 3.5, 3.6, 4.1) in `openspec/changes/implement-cross-platform-subscription-billing-and-license-management/tasks.md` as superseded by this change.

## 6. Server Verification

- [x] 6.1 Add App Store Server API client module: JWT-signed requests, env config (`APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY`), documented secrets protocol.
- [x] 6.2 Rewrite `/v1/billing/validate` → verify signed transaction JWS (Apple root cert chain, bundle id, expiry, revocation, environment); reject anything unverifiable. Fixture-based tests: valid / expired / revoked / wrong bundle-id / tampered payloads. *(Expired/revoked covered at payload level; certificate-expiry covered by validity-window checks.)*
- [x] 6.3 Migration: new `store_transactions` table keyed by `original_transaction_id`; policy for pre-existing unverified `purchases` rows (mark unverified, re-derive on first reconciliation).
- [x] 6.4 Grant derivation: Pro tier derives ONLY from verified non-expired non-revoked transactions mapped via `appAccountToken` → user; anonymous purchases bind at next sign-in. Tests for the derivation matrix.
- [x] 6.5 ASNS v2 endpoint: verify `signedPayload` JWS; handle SUBSCRIPTION_RENEWED / EXPIRED / REFUND / REVOKE / GRACE_PERIOD / BILLING_RECOVERY / DID_CHANGE_RENEWAL_STATUS; idempotent by notification identity. Signature-mismatch and replay tests.
- [x] 6.6 Update `/v1/billing/subscriptions` + `/v1/billing/restore` to read verified data only.
- [x] 6.7 Implement real server fetch in Rust `entitlement_refresh` (contained change in `src-tauri/src/entitlements/mod.rs`); keep existing cache/TTL/grace tests green; add a transport test. *(Transport tests written but not executable on the implementation host: the whole-crate `cargo test --lib` build is broken by a pre-existing `src/tts` sherpa error on `main`, unrelated to this change. `cargo check --lib` shows zero errors in `entitlements/`.)*

## 7. Sandbox Verification

- [x] 7.1 Document the sandbox scenario matrix (purchase monthly, purchase annual, cancel, refund, ask-to-buy pending, restore on second device, relaunch persistence, grace) in `docs/release/ios-billing-sandbox.md`.
- [ ] 7.2 **Verification:** execute the matrix against App Store Connect sandbox testers on physical devices; record transactions ids/results as evidence for Proposal G. Levels required: simulator verified (local StoreKit config) AND physical-device sandbox verified. — *open: requires physical device + ASC access; matrix and recording format are ready.*
