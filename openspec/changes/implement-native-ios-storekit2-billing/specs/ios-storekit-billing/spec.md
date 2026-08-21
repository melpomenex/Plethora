## ADDED Requirements

### Requirement: iOS billing SHALL use StoreKit 2 as the source of commerce truth
On iOS, product discovery, purchase, transaction verification, entitlements, restore, and subscription management SHALL be performed through StoreKit 2 via the native `plethora-storekit` plugin. Displayed prices and titles for App Store products SHALL come from StoreKit's localized product data and MUST NOT be hard-coded anywhere in the repository.

#### Scenario: Paywall shows localized App Store pricing
- **WHEN** a user on iOS opens the paywall with network access
- **THEN** monthly and annual products render with Apple-localized names and prices fetched from StoreKit, and no literal price string authored in source code is displayed

#### Scenario: Product load fails
- **WHEN** StoreKit product retrieval fails
- **THEN** the paywall shows a retry state and does not display invented or fallback prices

### Requirement: Purchase outcomes SHALL cover the full state machine
The purchase flow SHALL distinguish purchased, pending (e.g., ask-to-buy), user-cancelled, and failed outcomes, and each SHALL produce an accurate UI state and a correct downstream entitlement result.

#### Scenario: Ask-to-buy approval arrives later
- **WHEN** a purchase enters the pending state and the approver accepts it while the app is closed
- **THEN** the transaction-update listener reconciles the entitlement on next launch or foreground without requiring a new purchase

### Requirement: Entitlements SHALL survive relaunch, revocation, and refund
Current entitlements SHALL be derived from verified transactions at launch; revoked or refunded transactions SHALL remove Pro access; expired subscriptions SHALL downgrade after any applicable grace period, with the billing-issue state visible during grace.

#### Scenario: Relaunch retains entitlement
- **WHEN** a subscribed user terminates and relaunches the app offline
- **THEN** Pro entitlements remain active from the cached verified snapshot and local `Transaction.currentEntitlements`

#### Scenario: Refund revokes access
- **WHEN** Apple issues a refund or revocation notification for the user's subscription
- **THEN** server-derived entitlements downgrade to free on next reconciliation and the client reflects it

### Requirement: Restore Purchases SHALL reconcile across devices
A Restore Purchases action SHALL invoke Apple's restore mechanism (`AppStore.sync()` or equivalent), re-derive entitlements from verified transactions, and work for a second device signed into the same Apple ID and Plethora account.

#### Scenario: Second-device restore
- **WHEN** a user signs into Plethora on a new device and taps Restore Purchases
- **THEN** their existing verified subscription is recognized and Pro is granted without a new purchase

### Requirement: Production builds MUST NOT use mock billing
When the build profile is `store`, activating `MockBillingProvider` MUST throw, the active provider on iOS MUST be the StoreKit-backed provider, and automated tests MUST enforce both invariants. Development builds MAY use the mock only with explicit dev-only labeling.

#### Scenario: Store build with mock billing fails
- **WHEN** a store-profile build would activate the mock provider as the billing backend
- **THEN** the invariant test fails the build

### Requirement: Apple transactions SHALL be verified server-side
The server SHALL verify App Store transaction JWS payloads (signature chain, bundle identity, expiry, revocation, environment) before granting any entitlement, SHALL treat `originalTransactionId` as the durable subscription key, and SHALL process App Store Server Notifications v2 only after verifying the signed payload. Unverifiable data MUST NOT grant or extend entitlements.

#### Scenario: Forged validation request is rejected
- **WHEN** a client posts an arbitrary transaction id or tampered payload to the validation endpoint
- **THEN** verification fails, no entitlement change occurs, and the attempt is logged

#### Scenario: Renewal notification extends entitlement
- **WHEN** a verified SUBSCRIPTION_RENEWED notification arrives
- **THEN** the subscription's expiry is extended idempotently; replaying the same notification produces no duplicate grants

### Requirement: Apple transactions SHALL bind to Plethora accounts
Purchases SHALL carry an `appAccountToken` bound to the signed-in Plethora account so entitlements map to the correct user across devices and reinstalls; purchases made while signed out SHALL bind to the account at next sign-in.

#### Scenario: Signed-out purchase binds later
- **WHEN** a user purchases Pro before signing in, then signs in with the same Apple ID and creates/uses a Plethora account
- **THEN** the server maps the transaction to that account via the stored app account token

### Requirement: Subscription management SHALL use Apple's surfaces
The app SHALL provide a Manage Subscription action that opens Apple's native subscription management, and SHALL NOT implement its own cancellation flow for App Store subscriptions.

#### Scenario: User cancels via Apple
- **WHEN** the user opens Manage Subscription from the app and cancels there
- **THEN** the app reflects the active-until-expiry state and downgrades after expiry per the notification/reconciliation path
