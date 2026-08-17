## ADDED Requirements

### Requirement: Billing is provider-abstracted
All purchase flows SHALL pass through a `BillingProvider` interface implemented per platform (StoreKit 2 plugin on iOS, Play Billing plugin on Android, hosted web checkout on desktop/web). No product/feature code SHALL reference a store or payment provider by name; products are identified by server-issued ids mirrored in store consoles.

#### Scenario: Feature code is store-agnostic
- **WHEN** an architecture test scans feature modules for store/SDK identifiers
- **THEN** only `src/lib/billing/` and the billing plugins reference them

### Requirement: Entitlements derive only from server-verified transactions
Client-submitted purchase handles (JWS transactions, purchase tokens, checkout sessions) SHALL be verified against the respective store's server API before grants are written. No capability SHALL ever be granted from client-attested data alone. Grant derivation (product → plan → capabilities + quotas) SHALL be server configuration, changeable without client release.

#### Scenario: Forged receipt rejected
- **WHEN** a client submits a malformed or non-verifiable purchase handle
- **THEN** validation fails, no grants change, and the error is reported without leaking verification details

### Requirement: Subscription lifecycle events are handled idempotently
Webhook endpoints SHALL verify provider signatures and deduplicate by event id. Renewal, cancellation, refund, grace entry/exit, and expiration SHALL map to deterministic grant transitions. Refund and expiration policy (immediate vs period-end) SHALL be configuration.

#### Scenario: Duplicate webhook is a no-op
- **WHEN** the same renewal event is delivered twice
- **THEN** grants and subscription state change exactly once

#### Scenario: Refund applies configured policy
- **WHEN** a refund webhook arrives and policy is `immediate`
- **THEN** Pro capabilities are revoked on the next entitlement refresh, with local data untouched

### Requirement: Restore purchases works across devices
A signed-in user SHALL be able to restore purchases: the server re-queries the store for entitlements bound to the account (via `app_account_token`/`obfuscated_account_id`/checkout binding) and re-derives grants. Purchases bound to a different account SHALL surface a conflict flow rather than silently transferring.

#### Scenario: New device restores Pro
- **WHEN** a user signs into a fresh install and taps Restore Purchases
- **THEN** previously purchased entitlements are re-granted after server verification

### Requirement: Trials and grace periods flow through grants
Intro/trial offers and store billing-grace states SHALL be represented as capability grants with expiry and reason (`trial`, `grace`), never as client-side flags. Grace expiry beyond the store window degrades to Free fallbacks per the proposal-2 contract.

#### Scenario: Grace period keeps Pro usable
- **WHEN** a payment method fails and the store reports billing grace
- **THEN** capabilities remain enabled with reason `grace` until the store resolves or the grace window ends

### Requirement: Purchase state is transactional client-side
Purchase flows SHALL be resumable: pending/failed/abandoned transactions (delivered late via store update listeners) SHALL reconcile to a clean state (granted, refunded, or cleared) without duplicated grants or stuck UI.

#### Scenario: Late transaction delivery reconciles
- **WHEN** the app relaunches after a purchase completed while offline
- **THEN** the pending transaction is submitted, validated, and reflected in entitlements exactly once
