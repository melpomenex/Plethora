## Context

### Frontend billing (verified)

- `src/lib/billing/types.ts`: `BillingProviderType = 'appstore' | 'playstore' | 'stripe' | 'mock'`; `BillingProvider { getProducts, purchase, getSubscription, restorePurchases }`; `MockBillingProvider` with hard-coded products (`plethora_pro_monthly`, `plethora_pro_annual`, 14-day trial) and a fake `mock_tx_*` purchase.
- `src/stores/billingStore.ts`: module-level `activeProvider = new MockBillingProvider()`; `setProvider()` exists but is only called from tests; `init()` exists but is never invoked at startup; on purchase success it refreshes the entitlement store locally.
- `src/components/monetization/PaywallModal.tsx` (mounted in `MainLayout.tsx`): reads `products` from billing store; falls back to hard-coded `$12/month`; "14-Day Free Trial" button is local-only cosmetic state (`paywallStore`), not enforced anywhere.
- `src/stores/entitlementStore.ts`: local overrides → cached snapshot (15-min TTL, 72-h grace) → free defaults; in Tauri it invokes Rust `entitlement_refresh`, which is a stub that never fetches from the server. Capability registry (`src/types/entitlements.ts`, `useCapability`, `CapabilityGate`) is real and verified.
- `src/main.tsx` exposes billing on `window.plethora` for dev; no init call.

### Server (verified)

- `POST /v1/billing/validate` (`server/src/routes/v1/billing.ts`): accepts `provider/productId/transactionId/receiptData`; **drops `receiptData`**; inserts a `purchases` row with fabricated +30d renewal; `UPDATE users SET subscription_tier='pro'`. No verification of any kind.
- `GET /v1/billing/subscriptions`, `POST /v1/billing/restore`: DB reads; restore re-grants from any `active` row.
- `POST /v1/billing/webhooks/:provider`: dedupe via `webhook_dedupe` + audit insert; **no signature verification**; no `signedPayload`/JWS/ASNS v2 handling anywhere in the repo.
- Auth (`/v1/auth/*`) is real and tested (bcrypt, JWT rotation with family revocation). `DELETE /v1/auth/account` is a real synchronous cascade.

### Rust (verified)

- `src-tauri/src/plethora_auth`: in-memory mock (`mock-user-uuid`, `mock-access-jwt`); no HTTP.
- `src-tauri/src/entitlements`: real cache/TTL/grace logic; `entitlement_refresh` is a stub that re-stamps `fetched_at`.
- Plugin template to copy: `plugins/plethora-folder-import` (Rust `ios_plugin_binding!` + `register_ios_plugin`, Swift `@_cdecl`, SwiftPM package named after crate).

### Stale claims (verified false)

`implement-cross-platform-subscription-billing-and-license-management/tasks.md`: 2.1, 2.2 (plugins), 3.2 (JWS verification), 3.4 (webhook signatures), 3.5, 3.6 (grant derivation/reconciliation), 4.1 (purchase intent path) marked `[x]` with no corresponding code.

## Goals / Non-Goals

**Goals:**

- Real StoreKit 2 commerce on iOS through the existing `BillingProvider` abstraction.
- A verified server-side path from Apple transactions to Plethora Pro entitlements.
- No production build can ship with mock billing; no hard-coded prices for App Store products.
- Full subscription lifecycle correctness: purchase, pending, cancel, failure, expiration, refund/revocation, billing retry/grace, restore, relaunch reconciliation, second device.

**Non-Goals:**

- Google Play Billing (type literal exists; out of scope — architecture must not preclude it).
- Stripe/web checkout (existing type only).
- Account lifecycle UX (Proposal F): F owns sign-in/upgrade/deletion screens and copy; B owns the billing engine and the manage-subscription deep link it exposes.
- Changing what Pro entitles (capability registry semantics unchanged).
- OAuth sign-in with Apple (separate concern; F notes it as a gap).

## Decisions

### 1. Native Tauri plugin `plethora-storekit`
Mirror the folder-import plugin structure: Rust crate `plethora-storekit` with `ios_plugin_binding!(init_plugin_plethora_storekit)` + `register_ios_plugin`; SwiftPM package named `plethora-storekit` exporting `@_cdecl("init_plugin_plethora_storekit")` (Proposal A's naming guard applies). Swift uses StoreKit 2 (`Product.products(for:)`, `product.purchase()`, `Transaction.currentEntitlements`, `Transaction.updates`, `AppStore.sync()`, `showManageSubscriptions`). Commands (draft contract, finalized in tasks):

- `storekit_get_products(ids) -> [StoreProduct]` — localized name/price/period/intro offer directly from StoreKit.
- `storekit_purchase(product_id, app_account_token) -> PurchaseResult` — states: `purchased | pending | cancelled | failed(reason)`.
- `storekit_current_entitlements() -> [VerifiedTransaction]`
- `storekit_restore() -> RestoreResult` (wraps `AppStore.sync()`)
- `storekit_start_transaction_listener()` — forwards `Transaction.updates` to the frontend via event `plethora-storekit-transaction-update`.
- `storekit_manage_subscriptions()` — opens Apple's manage-subscriptions sheet.
- `storekit_app_account_token() -> uuid?` — stable per-account UUID generated at sign-in, persisted, passed to purchases.

Verification: Swift validates `Transaction` JWS signature/chain via `VerificationResult`; unverified results are surfaced as errors, never granted. The verified transaction payload (originalTransactionId, transactionId, productId, expirationDate, revocationDate, environment, appAccountToken, signed JWS string) goes to both the server (for authoritative reconciliation) and the frontend.

### 2. Provider selection and the mock firewall
`billingStore.init(platform)` runs at app startup (`src/main.tsx`): iOS → `AppStoreBillingProvider` (wraps the plugin); desktop/web/development → mock with an explicit dev-only banner in the paywall. Firewall invariant (test-enforced): under `__PLETHORA_BUILD_PROFILE__ === 'store'`, constructing/activating `MockBillingProvider` throws; a store-profile iOS bundle asserting `getActiveProvider().type !== 'appstore'` fails. Paywall renders prices only from `ProductInfo.priceFormatted` returned by the active provider; the `$12/month` fallback is deleted — if products fail to load, the paywall shows a retry state, never invented prices.

### 3. Server verification model
Replace `/v1/billing/validate` semantics: client posts the signed JWS transaction from StoreKit 2; server verifies it (signature chain against Apple root certificates, expiration, bundle id, revocation) using an App Store Server API client (JWT-signed requests with the In-App Purchase key; env: `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY`). Grant derivation: `subscription_tier='pro'` derives ONLY from verified, non-expired, non-revoked transactions; `originalTransactionId` is the durable key. Add tables: `store_transactions` (original_transaction_id unique, latest signed payload, environment, status, expires_at, app_account_token → user). ASNS v2: verify the `signedPayload` JWS the same way; handle `SUBSCRIPTION_RENEWED`, `EXPIRED`, `REFUND`, `REVOKE`, `GRACE_PERIOD`, `BILLING_RECOVERY`, `DID_CHANGE_RENEWAL_STATUS`; idempotent by transaction id + signed date. `/v1/billing/restore` re-derives from verified transactions only.

Entitlement flow: server remains the entitlement authority (`GET /v1/entitlements`, unchanged contract); the Rust `entitlement_refresh` stub gains the actual HTTP fetch (small, contained change — coordinate: this touches `src-tauri/src/entitlements/mod.rs`, which B owns for this purpose; F/D must not edit it).

### 4. Account binding
At sign-in, the client generates/loads a stable UUID per Plethora account and passes it as `appAccountToken` on purchases; the server maps `appAccountToken → user_id` so entitlements survive reinstalls and bind correctly across devices. Anonymous/local-only use: purchases still work; binding happens at next sign-in via token match.

### 5. Offline & grace behavior
Cached entitlement snapshot (existing 15-min TTL) extended: verified-expired-but-in-grace transactions keep Pro with a visible "billing issue" state; hard expiry after grace downgrades to free. Offline relaunch uses the cached snapshot; `Transaction.currentEntitlements` is also checked locally on-device as a secondary source.

### 6. Sandbox test plan
Committed StoreKit configuration file (products mirroring App Store Connect ids `plethora_pro_monthly` / `plethora_pro_annual`) + a documented sandbox scenario matrix (Proposal G turns the matrix into evidence runs).

## Platform Boundaries

- Plugin compiles only for iOS; on other targets the crate exposes typed "unsupported" errors (pattern: `install_apk`).
- Desktop/web: mock remains available in development; store profile forbids it everywhere (invariant is profile-based, not OS-based, so a future Play provider slots in).

## Failure Behavior

- Product load failure → paywall retry state; no fabricated prices.
- Purchase pending (ask-to-buy) → UI "awaiting approval" state; entitlement granted later via `Transaction.updates` + server reconciliation.
- Server unreachable during purchase → transaction stored client-side as pending-reconciliation; retried on next launch/connectivity; local grace per §5.
- Unverifiable JWS → reject; log; never grant.

## UX States

Paywall: loading products / product cards (localized price, period, intro offer) / purchasing spinner / pending approval / error+retry / success. Settings/account: subscription status (plan, renewal date from verified transaction), Manage Subscription (native sheet), Restore Purchases button with spinner/result states (Proposal F owns placement/copy; B owns the data + actions).

## Security / Privacy Implications

- No receipt data leaves the device unencrypted beyond Apple's own JWS to Plethora's API over TLS.
- Server stores transaction identifiers and signed payloads (needed for accounting/refunds) — disclosure entry coordinated with Proposal C (`cloud` category, userDeletable=false for minimal transaction records per accounting needs; C finalizes the registry wording from B's documented data flows).
- Private ASC keys only in server env; never in the app bundle.

## Testing Strategy

- Unit: provider mapping (Swift-side logic via Rust-side result types where possible), billingStore init/selection, mock firewall invariant, price-rendering rule (no literal price strings in paywall source), server JWS verification against fixture payloads (valid, expired, revoked, wrong bundle id, tampered), ASNS handlers idempotency, grant derivation matrix.
- Integration: server route tests with fixture JWS; client pending-reconciliation retry.
- Manual/sandbox: full matrix in the StoreKit configuration sandbox + App Store Connect sandbox testers; recorded as evidence by Proposal G.

## Rollout

Land behind nothing (no flag needed on iOS — the feature simply doesn't exist today). Order: plugin skeleton → product query → purchase → entitlements/listener → server verification → webhooks → grace/restore polish. Desktop behavior unchanged.

## Alternatives Considered

- **react-native-iap / purchases-js style JS-only bridge via `evaluateJavascript`**: rejected — no RN runtime; Tauri mobile plugin is the sanctioned path and matches existing plugin precedent.
- **RevenueCat / subscription SaaS**: rejected — adds a third-party data processor, cost, and privacy surface for something the server can own; contradicts the zero-knowledge posture.
- **On-device-only entitlement (trust `Transaction.currentEntitlements`, skip server)**: rejected — server-side entitlements already gate cloud features and must reflect refunds/revocations cross-device; also needed for the existing web/desktop entitlement contract.

## Rejected Alternatives / Notes

- Reusing the old `/v1/billing/validate` endpoint shape with a "verified" flag: rejected — its contract (ignoring receipt data) is the bug; a clean verified-transaction contract is safer than a compatible lie.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| `src-tauri/plugins/plethora-storekit/**` | **B** | follows A's plugin conventions + naming guard |
| `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` | shared | B adds ONE cfg-guarded registration line + one dependency; conflicts trivial |
| `src/lib/billing/*`, `src/stores/billingStore.ts`, `src/components/monetization/*` | **B** | F consumes, must not edit |
| `src/main.tsx` init call | **B** | one-line; coordinate with D's startup changes if any |
| `src-tauri/src/entitlements/mod.rs` (refresh transport) | **B** | contained HTTP fetch; D/F read-only |
| `server/src/routes/v1/billing.ts`, new ASC client, migrations | **B** | F's deletion work consumes B's retention analysis |
| `src/lib/buildProfile.ts` consumption | B (read-only) | signature agreed with A |

**With F:** B exposes `billingStore` events/state; F builds screens on them. F must not modify billing internals; if F needs a new query, it requests it as a B task.
**With C:** B documents exact off-device data flows (transaction JWS → Plethora server; Apple) as registry input; C writes the disclosure.
**With G:** B's sandbox matrix is the source for G's billing evidence scenarios; G owns evidence format.
