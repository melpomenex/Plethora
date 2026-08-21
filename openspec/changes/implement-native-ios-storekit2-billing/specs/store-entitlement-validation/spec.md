## ADDED Requirements

### Requirement: Entitlement grants SHALL derive only from verified store data
The server SHALL derive Plethora Pro entitlements exclusively from verified App Store transactions and signed notifications. Any legacy unverified purchase record MUST be treated as non-granting until re-verified against Apple.

#### Scenario: Legacy unverified row cannot grant Pro
- **WHEN** a `purchases` row created before verification existed is encountered during entitlement resolution
- **THEN** it does not grant Pro until Apple-side verification confirms the transaction

### Requirement: Transaction records SHALL be durable and auditable
Verified transactions, notification processing, and grant/revoke decisions SHALL be stored with enough fidelity (original transaction id, environment, timestamps, signed payload) to support accounting, refunds, fraud analysis, and account-deletion retention requirements.

#### Scenario: Refund investigation
- **WHEN** support needs to investigate a refund dispute for an original transaction id
- **THEN** the stored verified transaction history answers status, dates, and environment without guessing

### Requirement: Client entitlement refresh SHALL contact the server
The native client's entitlement refresh SHALL fetch the authoritative snapshot from `/v1/entitlements` over authenticated transport instead of stubbing locally, preserving the existing cache TTL and offline grace semantics.

#### Scenario: Desktop/iOS refresh reflects server revocation
- **WHEN** a user's subscription is revoked server-side and any client refreshes entitlements online
- **THEN** the refreshed snapshot disables gated capabilities within one cache cycle

### Requirement: Verification failures SHALL fail closed
Every verification path (validation endpoint, notifications, restore) SHALL reject unverifiable input without granting entitlements and SHALL record the failure for auditing.

#### Scenario: Tampered JWS rejected
- **WHEN** a signed payload's signature fails validation at any entry point
- **THEN** no entitlement change occurs and the failure is logged with sufficient context to diagnose
