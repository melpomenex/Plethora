## ADDED Requirements

### Requirement: Native Android Play Billing plugin
The system SHALL provide a registered Tauri Android plugin `plethora-playbilling` using Google Play Billing Library 7.1.1 that queries subscription ProductDetails, launches purchase flows, emits purchase updates, and queries owned subscriptions.

#### Scenario: Store build selects Play provider
- **WHEN** `PLETHORA_BUILD_PROFILE=store` on Android
- **THEN** the billing abstraction uses `PlayBillingProvider` backed by the native plugin

### Requirement: Server-verified entitlement
The system SHALL grant Pro only after the server verifies the purchase token with Google Publisher API and acknowledges if pending.

#### Scenario: Pending purchase
- **WHEN** Google reports subscription state PENDING
- **THEN** the user does not receive Pro entitlement

### Requirement: Production API URL
Store-profile Android builds SHALL use `https://api.useplethora.com` and fail the build if configured otherwise.

#### Scenario: Store build gate
- **WHEN** building with `PLETHORA_BUILD_PROFILE=store`
- **THEN** Vite asserts the resolved API URL equals `https://api.useplethora.com`
