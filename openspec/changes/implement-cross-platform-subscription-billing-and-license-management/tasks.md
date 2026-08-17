# Implementation Tasks

## 1. Client provider abstraction
- [ ] 1.1 `src/lib/billing/types.ts` + `BillingProvider` interface (products, purchase, entitlements, restore, updates listener)
- [ ] 1.2 Mock provider with deterministic fixtures for tests/CI
- [ ] 1.3 `src/stores/billingStore.ts` + purchase-state machine (idle→pending→verifying→granted/failed/abandoned) with reconciliation on relaunch

## 2. Native plugins
- [ ] 2.1 `src-tauri/plugins/plethora-storekit` (StoreKit 2): products, purchase, current entitlements, transaction updates, restore, app_account_token binding
- [ ] 2.2 `src-tauri/plugins/plethora-playbilling` (Play Billing 7+): equivalent surface + obfuscated_account_id
- [ ] 2.3 Web/desktop: checkout-session flow via hosted provider (env-configured) + `plethora://billing/callback`
- [ ] 2.4 Plugin capability permissions + TS bridges; register in `lib.rs`

## 3. Server billing service
- [ ] 3.1 Postgres tables: `purchases`, `subscription_events`, `webhook_dedupe`, grants integration
- [ ] 3.2 `POST /v1/billing/validate` — provider adapters verifying against App Store Server API v2 (JWS), Play Developer API, web provider API
- [ ] 3.3 `GET /v1/billing/subscriptions` (unified view) + `POST /v1/billing/restore`
- [ ] 3.4 Webhooks `/v1/billing/webhooks/{provider}`: signature verification, event-id dedupe, out-of-order guards
- [ ] 3.5 Grant-derivation config (product→capabilities/quotas; refund/grace policy knobs) + unit matrix tests
- [ ] 3.6 Reconciliation job: periodic store re-query for active subscriptions (catches missed webhooks)

## 4. UX wiring (minimal; surfaces in proposal 21)
- [ ] 4.1 Purchase intent path: CapabilityGate reason → paywall hook → provider purchase → validate → entitlement refresh event
- [ ] 4.2 Subscription management entry point + restore purchases control
- [ ] 4.3 i18n: purchase/restore/error strings in 6 locales

## 5. Validation
- [ ] 5.1 Adapter tests with recorded store fixtures (incl. revoked certs, refund/grace/expiry matrices)
- [ ] 5.2 Webhook idempotency + signature-rejection tests
- [ ] 5.3 Client flow tests with mock provider (offline transaction delivery, abandoned purchase cleanup)
- [ ] 5.4 Sandbox end-to-end verification checklist per platform (documented for proposal 23)
