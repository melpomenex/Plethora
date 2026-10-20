## Purpose

Give each AI Learning feature an accurate, recoverable readiness state while keeping user preferences separate from expensive setup and private-content authorization.

## ADDED Requirements

### Requirement: Per-feature dependency readiness

The system SHALL report enabled preference, platform support, required capabilities, native integrations, model and provider readiness, indexing dependencies, permissions, billing/disclosure requirements, operational evidence where known, and actionable recovery for each AI Learning feature. Readiness SHALL distinguish disabled, ready, setup required, model download required, indexing, platform unavailable and error. Ready dependencies SHALL NOT imply successful operational execution.

#### Scenario: Native unavailable with permitted configured provider
- **WHEN** a native model is unavailable but an authorized configured provider satisfies the operation
- **THEN** the feature reports that selected path and its limitations rather than declaring the whole platform unsupported

#### Scenario: No qualifying model
- **WHEN** a required model is missing or its status is still being checked
- **THEN** readiness shows the missing dependency or checking state and never claims ready

#### Scenario: Retrieval degrades to lexical mode
- **WHEN** generation is available but embeddings are not
- **THEN** features that support lexical retrieval disclose the degradation while semantic indexing itself remains not ready

### Requirement: Capability-aware Enable All

Enable All SHALL explicitly enable supported main learning-feature preferences, report partial readiness per feature, preserve unsupported preferences and unrelated user choices, and offer recovery for unmet dependencies. It SHALL NOT change cloud consent, provider choice, paid embeddings, freeform vision or an intentionally disabled active-recall interaction mode.

#### Scenario: Partial activation
- **WHEN** Enable All is invoked with some models missing and some features unsupported
- **THEN** supported feature preferences are enabled, unsupported preferences remain as before, and the summary separates ready features from setup needs

#### Scenario: Independent relationship controls
- **WHEN** the user changes prerequisite analysis without changing concept links
- **THEN** only the prerequisite preference changes and both subfeature states remain visible

### Requirement: Setup is independently authorized

Feature enabling, readiness inspection and Settings search SHALL NOT initiate downloads, indexing, inference, uploads or paid operations. Every expensive setup action SHALL use explicit user authorization and the existing consent and progress controls.

#### Scenario: Enabling flags is side-effect free
- **WHEN** a user opens AI Settings, finds a readiness row through search or invokes Enable All
- **THEN** no model download, library backfill or generation request starts

#### Scenario: User authorizes indexing
- **WHEN** the user explicitly starts indexing and completes required cost/privacy confirmation
- **THEN** progress, pause, cancellation and charging behavior use the existing index workflow

#### Scenario: Setup denied
- **WHEN** setup or cloud authorization is declined
- **THEN** the feature remains enabled with its unmet dependency accurately shown and no remote work occurs

#### Scenario: Keyless off-device destination
- **WHEN** a configured provider requires no API key but points to a remote Ollama or LAN server
- **THEN** its authentication/billing status does not bypass off-device processing disclosure and authorization

### Requirement: Restart and upgrade reconciliation

Upgrade SHALL preserve explicit existing preferences and consent. Restart SHALL recompute readiness from current dependencies and expose recoverable interrupted setup without automatically approving new expensive work.

#### Scenario: Explicit false survives migration
- **WHEN** persisted settings contain false for a learning feature while another feature key is absent
- **THEN** migration preserves false and applies the existing default only to the absent key

#### Scenario: Interrupted model setup
- **WHEN** the app restarts after a model or indexing setup was interrupted
- **THEN** the owning service's state is displayed with a valid recovery action and no stale ready badge

### Requirement: Readiness reacts to policy changes

Readiness and action execution SHALL re-evaluate changed model, provider, permission, consent and index state; stale probe results SHALL NOT authorize a replacement operation. New Settings controls and groups SHALL be discoverable through safe localized search targets.

#### Scenario: Provider removed during probe
- **WHEN** a provider is removed while its readiness probe is pending
- **THEN** the late probe cannot mark the replacement configuration ready and execution performs a fresh check

#### Scenario: Search reveals recovery
- **WHEN** keyboard or touch search opens a feature recovery destination
- **THEN** the user reaches its existing setup explanation without a setting change or setup side effect
