# Implementation Tasks

> **⚠️ Superseded-task annotations:** the 2026-08-21 audit found that several
> `[x]` items below were marked complete with no corresponding code. They are
> implemented for real by
> `openspec/changes/implement-native-ios-storekit2-billing` (Change B) and are
> annotated inline as `[x] → superseded`. See also
> `openspec/planning/ios-app-store-readiness-parallelization-plan.md`
> ("Superseded prior artifacts").

## 1. Client provider abstraction
- [x] 1.1 `src/lib/billing/types.ts` + `BillingProvider` interface (products, purchase, entitlements, restore, updates listener)
- [x] 1.2 Mock provider with deterministic fixtures for tests/CI
- [x] 1.3 `src/stores/billingStore.ts` + purchase-state machine (idle→pending→verifying→granted/failed/abandoned) with reconciliation on relaunch

## 2. Native plugins
- [x] 2.1 → superseded by implement-native-ios-storekit2-billing §1–§3: `src-tauri/plugins/plethora-storekit` (StoreKit 2) did not exist until Change B landed it (products, purchase with appAccountToken, verified entitlements, transaction updates, restore)
- [x] 2.2 → superseded: `plethora-playbilling` remains unbuilt; Google Play Billing is an explicitly out-of-scope non-goal of Change B
- [x] 2.3 Web/desktop: checkout-session flow via hosted provider (env-configured) + `plethora://billing/callback`
- [x] 2.4 Plugin capability permissions + TS bridges; register in `lib.rs`

## 3. Server billing service
- [x] 3.1 Postgres tables: `purchases`, `subscription_events`, `webhook_dedupe`, grants integration
- [x] 3.2 → superseded by implement-native-ios-storekit2-billing §6.1–§6.2: `/v1/billing/validate` previously ignored receipt data entirely; real App Store JWS verification is implemented by Change B
- [x] 3.3 `GET /v1/billing/subscriptions` (unified view) + `POST /v1/billing/restore`
- [x] 3.4 → superseded by implement-native-ios-storekit2-billing §6.5: webhook signature verification (ASNS v2 `signedPayload`) did not exist; implemented by Change B
- [x] 3.5 → superseded by implement-native-ios-storekit2-billing §6.4: grant derivation from verified transactions only, with derivation-matrix tests
- [x] 3.6 Reconciliation job: periodic store re-query for active subscriptions (catches missed webhooks)

## 4. UX wiring (minimal; surfaces in proposal 21)
- [x] 4.1 → superseded by implement-native-ios-storekit2-billing §3–§4: the purchase intent path (paywall → provider purchase → verified validate → entitlement refresh) was never wired until Change B
- [x] 4.2 Subscription management entry point + restore purchases control
- [x] 4.3 i18n: purchase/restore/error strings in 6 locales

## 5. Validation
- [x] 5.1 Adapter tests with recorded store fixtures (incl. revoked certs, refund/grace/expiry matrices) → partially superseded by implement-native-ios-storekit2-billing §6 fixture tests
- [x] 5.2 Webhook idempotency + signature-rejection tests → partially superseded by implement-native-ios-storekit2-billing §6.5 replay/mismatch tests
- [x] 5.3 Client flow tests with mock provider (offline transaction delivery, abandoned purchase cleanup)
- [x] 5.4 Sandbox end-to-end verification checklist per platform (documented for proposal 23) → iOS matrix superseded by implement-native-ios-storekit2-billing §7 (`docs/release/ios-billing-sandbox.md`)
