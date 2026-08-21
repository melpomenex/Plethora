## ADDED Requirements

### Requirement: Account deletion SHALL be accurate, discoverable, and honest
The iOS app SHALL expose account deletion within Settings in a flow that states exactly what is deleted and what is retained, offers data export before confirmation, requires explicit confirmation, distinguishes success from failure unambiguously, and never signs the user out while the server-side deletion has failed.

#### Scenario: Deletion succeeds
- **WHEN** the server confirms deletion
- **THEN** the user is signed out with an accurate confirmation and, if subscribed, an explicit reminder that the Apple subscription continues until cancelled separately, with a path to Apple's subscription management

#### Scenario: Deletion fails
- **WHEN** the deletion request fails (network/server error)
- **THEN** the user sees an error with a retry option and remains signed in; no success indication is shown

### Requirement: Deleting the Plethora account MUST NOT imply cancelling the Apple subscription
Wherever deletion is presented to a user with an active or in-grace App Store subscription, the UI MUST state that Apple billing continues until cancelled in Apple's subscription settings and MUST provide a direct path to that settings surface. The app MUST NOT claim or imply the subscription was cancelled by account deletion.

#### Scenario: Subscribed user deletes account
- **WHEN** a user with an active StoreKit subscription completes account deletion
- **THEN** the flow explicitly warned beforehand and the completion state reiterates that Apple billing continues until separately cancelled

### Requirement: Authentication SHALL never fabricate sessions
Sign-in SHALL create a session only upon verified server success; network failures SHALL surface as errors with retry and MUST NOT produce a locally simulated signed-in state. Production builds MUST NOT contain active mock sign-in paths.

#### Scenario: Offline sign-in attempt
- **WHEN** a user attempts to sign in with no connectivity
- **THEN** an error with retry is shown and the app remains in signed-out (local-only usable) state

### Requirement: Subscription lifecycle SHALL be visible and manageable in-app
The app SHALL display current subscription status (plan, renewal date, grace/billing-issue state), provide Restore Purchases, and provide Manage Subscription on iOS that opens Apple's subscription management. Entitlement loss (expiry, refund, revocation) SHALL be reflected with clear messaging and a resubscribe path, without trapping users mid-state.

#### Scenario: Restore on a fresh install
- **WHEN** a returning subscriber installs Plethora on a new device, signs in, and taps Restore Purchases
- **THEN** Pro status is recognized and displayed with renewal information

#### Scenario: Grace period state
- **WHEN** a renewal fails and Apple places the subscription in billing grace
- **THEN** Pro features remain available with visible billing-issue messaging until grace resolves

### Requirement: Post-deletion behavior SHALL be consistent across devices
After confirmed deletion, the local device SHALL transition cleanly to signed-out local-only mode, other devices' sessions SHALL fail naturally at next authentication, and the deleted account MUST NOT be able to sign in again.

#### Scenario: Deleted account cannot return
- **WHEN** the deleted account's credentials are used on any device
- **THEN** sign-in is rejected by the server with an account-not-available indication

#### Scenario: Second device after deletion
- **WHEN** a still-signed-in second device attempts an authenticated action after the account was deleted elsewhere
- **THEN** it transitions to signed-out local-only mode without data loss or crashes
