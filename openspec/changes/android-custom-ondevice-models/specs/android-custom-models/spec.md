## ADDED Requirements

### Requirement: Hardware tiers prevent impossible downloads
The system SHALL classify devices into none / embed / gen before offering a generative AI pack. Devices in `none` SHALL NOT be prompted to download a multi-GB LLM.

#### Scenario: Low-memory device
- **WHEN** RAM/targeting says the generative pack is incompatible
- **THEN** Plethora does not fetch it
- **AND** other app features work

#### Scenario: Explicit download UX
- **WHEN** a gen-tier user opts in
- **THEN** UI shows size, progress, cancel, and storage impact
- **AND** the model is hashed/verified before use

### Requirement: License provenance
Every Plethora-managed model artifact SHALL record name, version, source, license, and commercial-use permission in an in-app registry. Artifacts without redistribution rights SHALL NOT be shipped.

#### Scenario: No silent cloud when local-model fails
- **WHEN** a local-model generate fails and `allowCloudFallback` is false
- **THEN** content is not sent to OpenRouter
