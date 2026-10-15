## ADDED Requirements

### Requirement: Pessimistic controller defaults
The host controller SHALL default capabilities to unavailable unless production overrides are supplied.

#### Scenario: Ready host without overrides
- **WHEN** a host resolves to `ready` without explicit capability overrides
- **THEN** action capabilities such as translation and tutor SHALL default to unavailable

### Requirement: Translation capability truthfulness
`translation.available` SHALL be true only when a configured translation provider can serve the profile language pair.

#### Scenario: AI translation configured
- **WHEN** a cloud AI provider is configured for an es→en profile
- **THEN** `translation.available` SHALL be true with provider identity in capability detail

#### Scenario: No translation provider
- **WHEN** no translation provider is configured for the language pair on the current platform
- **THEN** `translation.available` SHALL be false with an explanatory reason

### Requirement: Tutor capability truthfulness
`tutor.available` SHALL be true only when a configured AI path exists.

#### Scenario: No AI configured
- **WHEN** no on-device or cloud AI path is available
- **THEN** tutor actions SHALL be disabled in the host panel

### Requirement: Reading assist truthfulness
`readingAssist.available` SHALL be true only when a registered reading-assist provider supports the request kind and language.

#### Scenario: No reading assist provider
- **WHEN** no reading assist provider is registered
- **THEN** reading assist actions SHALL be disabled and overlays SHALL report unsupported state

### Requirement: Practice and pronunciation truthfulness
Practice capabilities SHALL reflect available STT routes. Pronunciation dimensions SHALL be limited to those advertised by the injected manifest.

#### Scenario: Groq configured for shadowing
- **WHEN** Groq transcription is configured
- **THEN** practice SHALL be available and shadowing MAY default to the cloud route

#### Scenario: No STT provider
- **WHEN** neither local nor cloud STT is configured
- **THEN** pronunciation feedback SHALL not advertise unsupported dimensions
