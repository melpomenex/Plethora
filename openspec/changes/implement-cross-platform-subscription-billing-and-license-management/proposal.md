# Change: Implement Cross-Platform Subscription Billing and License Management

> Wave 1 — Commercial Foundation. Hard-depends on `implement-plethora-accounts-authentication-and-entitlements` (accounts/devices) and `implement-plethora-pro-cloud-service-and-usage-quota-architecture` (service framework to host billing routes). Soft-depends on proposal 2 (capability grants target).

## Why

Plethora Pro is a subscription sold through the Apple App Store, Google Play, and the web. Payment providers must never leak into product code: capabilities are derived from **server-authoritative entitlement grants** (proposal 2/3), and billing's job is to convert store transactions into those grants. The architecture must support monthly/annual plans, trials, refunds, expiration, restore purchases, grace periods, and account/store identity reconciliation — without hard-coding store rules that change yearly.

## What exists today
- Nothing. No StoreKit/Play Billing integration, no receipt validation, no web checkout. The only trace is `users.subscription_tier` (display label) and the "Upgrade to Pro" stub panel (`UserProfilePanel.tsx`). The server (`server/`) has JWT auth to build on. On-device, there is strong precedent for custom Tauri mobile plugins (`src-tauri/plugins/incrementum-android-genai`, `incrementum-android-tts` — Kotlin plugins with TS bridges) that this change follows for native billing.

## What Changes

### 1. Store-plugin layer (client, per platform)
- **iOS**: `plethora-storekit` Tauri plugin (Swift/Kotlin pattern per existing plugins; StoreKit 2): `load_products`, `purchase(product_id)`, `current_entitlements`, `transaction_updates` listener, `restore`, `app_account_token` binding.
- **Android**: `plethora-playbilling` plugin (Play Billing 7+): equivalent surface (`launch_billing_flow`, `query_purchases`, `purchase_updates_listener`, `acknowledge`).
- **Web/desktop**: hosted checkout (provider behind an interface — Stripe vs Paddle vs LemonSqueezy is a deployment decision recorded in env, not code): redirect flow via `plethora://billing/callback` + web callback.
- A thin `BillingProvider` TS interface (`src/lib/billing/`) abstracts all three; UI code never names a store.

### 2. Server billing service (`server/src/routes/billing.ts`, framework per proposal 5)
- `POST /v1/billing/validate` — client submits a purchase/receipt handle (JWS transaction for App Store, purchase token for Play, session id for web); server verifies with the **store's server API** (App Store Server API v2 JWS verification; Google Play Developer API; webhook signature for web provider), then writes capability grants.
- `GET /v1/billing/subscriptions` — unified view: `{ provider, product_id, status: active|grace|expired|refunded|cancelled, period, renewal, trial? }`.
- `POST /v1/billing/restore` — re-pull latest entitlements from stores for the signed-in account and re-derive grants.
- Webhooks: `/v1/billing/webhooks/{appstore|playstore|web}` for renewals, refunds, grace entry/exit, cancellations — signature-verified, idempotent (event id dedupe table).
- **Grant derivation rules** (server config, not client): product → plan → capability grants + quotas (proposal 5's quota envelopes). Refund → grants revoke at period end or immediately per policy. Grace periods mirror store grace configuration; during grace, capabilities remain on with `reason: "grace"`.

### 3. Account ↔ store identity reconciliation
- App Store `app_account_token` and Play `obfuscated_account_id` bind purchases to Plethora account UUIDs set at purchase time; web checkout binds by session. Restore on a new device with a different account: grants attach to the account whose token matches; mismatches surface a user-facing conflict flow (keep grants on purchasing account; product decision documented).
- Cross-store stacking: not merged in v1 — latest active subscription wins per capability family; documented.

### 4. Client UX plumbing (minimal here; surfaces in proposal 21)
- `billingStore` (TS) with products/subscription state; purchase intents flow: capability gate → paywall (21) → provider purchase → validate → entitlement refresh event. Failed/abandoned purchases never leave partial state.
- Desktop: no in-app store purchase (guideline constraints for macOS mas? — this repo ships outside the MAS; desktop uses web checkout only). Android/iOS use native stores exclusively.

### 5. Testing infrastructure
- Store sandbox/mock adapters implementing `BillingProvider` + fake store server endpoints (deterministic fixtures); state-machine tests for grant derivation (renewal, refund, grace, expiry, restore, family-revocation interplay).

## Impact

### Affected Specs
- `subscription-billing` — New (provider abstraction, validation, webhooks, reconciliation, state mapping).

### Affected Code Areas
- New: `src-tauri/plugins/{plethora-storekit,plethora-playbilling}/`, `src/lib/billing/`, `src/stores/billingStore.ts`, `server/src/routes/billing.ts`, webhook middleware, grants derivation module (server), Postgres tables (`purchases`, `subscription_events`, `webhook_dedupe`, grants store integration).
- Modified: capabilities registration for plugin permissions; i18n (6 locales) for purchase error/restore strings.

### Non-goals
- No pricing decisions encoded in code (products configured in stores + server env), no lifetime licenses in v1 (architecture permits: a grant without expiry), no gift cards/regional promos handling, no paywall UX design (21), no desktop in-app purchasing.

## Dependencies

### Hard dependencies
- Proposal 3 (accounts, device binding), proposal 5 (service framework, grants/quota store), rebrand (plugin naming follows new prefix).

### Soft dependencies
- Proposal 2 (grants target the capability registry — interface available early).

### May run concurrently
- Proposals 6, 16–20 (cloud features) — they consume grants, not billing.

### Must not start yet
- Proposal 21 (paywall UX) needs `billingStore` interfaces; proposal 23 (store release) needs verified billing on devices.

## Shared interfaces (owned here)
- `BillingProvider` client interface; `/v1/billing/*` endpoints; `subscriptions` view shape; grant-derivation config schema (product→capabilities); `billing-purchase-completed` / `billing-state-changed` events.

## Ownership boundaries
- **May modify**: new billing modules/plugins, server billing routes, grants-derivation rules, `billingStore`.
- **Must treat as external**: entitlement snapshot/resolution (2), auth middleware (3/5), quota enforcement mechanics (5), paywall presentation (21).

## Collision risks
- Server route registration + middleware (with 3/5): contract-first commits. Plugin capability files (with rebrand-landed prefixes). `UserProfilePanel` (3 owns structure; 21 owns upgrade UI; this change only adds subscription-management entry points).

## Integration contract
- Emits normalized subscription state + triggers `entitlement_refresh`; consumes proposal-2 registry ids in grants; never exposes provider names to feature code.

## Testing & acceptance

### Tests
- Provider adapters against recorded store responses (App Store JWS fixtures incl. revoked/old-cert cases; Play RTDN-style webhook fixtures; web provider webhook signature checks).
- Webhook idempotency (same event twice → one grant change); out-of-order event handling (version/sequence guards).
- Grant derivation matrix: purchase/renew/refund/grace/expire/restore × monthly/annual/trial.
- Client: purchase flow with mock provider → snapshot updates; abandoned purchase leaves clean state; offline purchase result delivery via `transaction_updates` (mobile) after reconnect.
- Security: webhook signature enforcement (reject unsigned), no client-trusted receipts (client-submitted handles always re-verified server-side against store APIs).

### Acceptance criteria
- A sandbox purchase on Android and iOS (and web checkout) grants Pro capabilities within one refresh; refund revokes per policy; restore on a fresh install recovers entitlements; grace period behaves per store config; all state visible in subscription management UI (21).

### Must remain unchanged
- Everything when no purchase has occurred; Free defaults unchanged.

## Open questions
1. Web checkout provider selection (Stripe vs Paddle vs LemonSqueezy — tax-handling implications).
2. Refund policy immediacy (immediate revoke vs end-of-period).
3. Cross-account restore conflict UX wording (legal-sensitive in some regions).
4. Upgrade/downgrade/proration handling matrix per store (v1: plan changes at renewal only?).
