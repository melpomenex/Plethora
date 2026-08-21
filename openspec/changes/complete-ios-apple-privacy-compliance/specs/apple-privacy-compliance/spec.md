## ADDED Requirements

### Requirement: The iOS bundle SHALL carry a valid, evidence-backed privacy manifest
The production iOS app SHALL include a `PrivacyInfo.xcprivacy` whose declared Required Reason API categories and reason codes correspond to APIs actually used by the compiled application and its linked dependencies, as determined by auditing the production archive. The manifest SHALL survive project regeneration via the overrides pipeline and the exported archive SHALL validate without privacy-manifest errors.

#### Scenario: Manifest survives regeneration
- **WHEN** `gen/apple` is regenerated and overrides are applied
- **THEN** the resulting archive contains the current privacy manifest

#### Scenario: Validation rejects unevidenced declarations
- **WHEN** the manifest audit cannot produce evidence for a declared category
- **THEN** that declaration is removed rather than shipped on speculation

### Requirement: Privacy disclosures SHALL be user-visible and traceable
Every entry in the internal disclosure registry SHALL be rendered in an in-app Privacy Center, and every App Store privacy-nutrition-label answer SHALL be derivable from the registry via a maintained mapping document enforced by automated consistency tests.

#### Scenario: User reviews data flows
- **WHEN** a user opens Settings → Privacy
- **THEN** all registered disclosures (sync, AI, TTS, transcription, capture, transactions, telemetry) are visible with destination, trigger, retention, and local-fallback information

#### Scenario: Label answer traced to code reality
- **WHEN** a reviewer questions a nutrition-label answer
- **THEN** the mapping document resolves it to a registry id backed by implementation and tests

### Requirement: Cloud-AI transmission SHALL be disclosed at first use
Before content first leaves the device for a configured cloud AI provider, the app SHALL present a disclosure stating what content is transmitted, which provider receives it, why, whether the provider is BYO-key or Plethora-hosted, and what local alternative exists. Consent SHALL be persistent per provider class, honored thereafter, and re-prompted only when the provider class changes. Fully local providers MUST NOT trigger the disclosure.

#### Scenario: First summary with a cloud provider
- **WHEN** a user invokes AI summarization configured to a cloud model for the first time
- **THEN** the disclosure appears once, records the choice, and does not reappear for that provider class unless the class changes

#### Scenario: Local-only configuration skips disclosure
- **WHEN** all active AI features resolve to on-device or locally-hosted providers
- **THEN** no cloud disclosure interrupts the workflow

### Requirement: iOS permissions SHALL be accurate and contextual
Every iOS permission the app can trigger SHALL have an accurate, user-oriented purpose string, SHALL correspond to a real feature, and SHALL be requested at the moment of feature use rather than at launch. Declared-but-unused capabilities MUST be removed.

#### Scenario: No launch-time permission prompts
- **WHEN** the app is freshly installed and launched without touching any permission-gated feature
- **THEN** no system permission dialog appears

#### Scenario: Microphone requested at dictation
- **WHEN** a user first activates a microphone-dependent feature
- **THEN** the purpose string shown accurately describes that feature's use of the microphone

### Requirement: Telemetry claims SHALL match shipped behavior
Privacy documentation and disclosures SHALL describe exactly the analytics/telemetry that ships. Any third-party analytics included in any build target SHALL appear in the disclosure registry; claims about absent systems (e.g., crash reporting) MUST NOT remain if untrue.

#### Scenario: Web analytics disclosed
- **WHEN** a build target includes third-party web analytics
- **THEN** a corresponding disclosure entry exists describing destination, trigger, and data scope
