## ADDED Requirements

### Requirement: Monetization surfaces are contextual and honest
Every Pro capability SHALL surface via contextual entry points with machine-readable reasons from the entitlement system (`signed_out`, `plan`, `quota_exhausted`, `grace`, `offline`), each rendering the appropriate CTA (sign-in, upgrade, quota status with reset time, or status note). Paywall content SHALL state what the capability does, what is cloud vs local, and quota implications.

#### Scenario: Signed-out user gets sign-in first
- **WHEN** an unauthenticated user triggers a Pro capability surface
- **THEN** the fallback offers sign-in (not purchase) with the capability explanation

#### Scenario: Quota state over upsell
- **WHEN** quota is exhausted
- **THEN** the surface shows usage, reset time, and local alternatives before any upgrade CTA

### Requirement: No dark patterns
Surfaces SHALL NOT use countdown timers, fabricated scarcity, pre-checked options, confirm-shaming copy, or recurring interruption modals. Frequency caps SHALL be enforced for all discovery surfaces. Automated checks SHALL scan locale files and component patterns for banned constructs.

#### Scenario: Banned-pattern check
- **WHEN** the dark-pattern test scans monetization components and all six locale files
- **THEN** no banned timer/scarcity/pre-check/confirm-shaming constructs are found

### Requirement: Reading and review are monetization-free zones
No paywall, upgrade prompt, or discovery modal SHALL render within reader views or review sessions (post-session summaries excepted where individually specified). This SHALL be enforced by an architecture/interaction test.

#### Scenario: Reader invariant
- **WHEN** a Pro-gated feature is triggered from inside the reader
- **THEN** any monetization surface appears as an inline affordance, never a modal interrupting reading

### Requirement: Free-tier value is stated prominently
The Pro catalog SHALL explicitly enumerate what remains free (local reading, extraction, scheduling, local AI/TTS/transcription, BYO providers, backups) alongside Pro capabilities, in every locale.

#### Scenario: Catalog lists free guarantees
- **WHEN** the Plethora Pro settings page renders
- **THEN** a clear "always free" section lists the local-first guarantees

### Requirement: Quota UX is uniform
A shared quota meter and spend-estimate dialog SHALL be used by all quota-bearing capabilities, rendering `QuotaState` (used/limit/window/reset) and pre-flight estimates consistently.

#### Scenario: Consistent meter everywhere
- **WHEN** quota surfaces render in TTS, transcription, reconstruction, and capture contexts
- **THEN** they use the same component with capability-specific labels and estimates

### Requirement: Expiry, offline, and downgrade preserve data and dignity
Expired subscriptions SHALL degrade capabilities to local fallbacks with a single post-expiry notice (no recurring modals); offline/grace states SHALL show status, not upsells; cancellation SHALL never delete or lock local data — stated explicitly in paywall and help copy, and proven by integration tests.

#### Scenario: Cancel keeps everything local
- **WHEN** a subscription expires after heavy Pro usage
- **THEN** the local library, extracts, cards, and history remain fully accessible and no data is deleted

### Requirement: Purchase, trial, and management flows are complete
The paywall SHALL support provider-appropriate purchase (native stores on mobile, web checkout on desktop/web), trial entry when eligible with visible remaining time, restore purchases, entitlement refresh, and provider-appropriate management links — all via proposal-4's billing interfaces without provider names in UX code.

#### Scenario: Restore from settings
- **WHEN** a re-installing user taps Restore Purchases in subscription management
- **THEN** entitlements recover via the billing flow and surfaces update
