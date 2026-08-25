## ADDED Requirements

### Requirement: Foundry Local HTTP client
The Foundry Local adapter SHALL use the OpenAI-compatible chat completions endpoint and SHALL distinguish runtime unavailable from model unavailable.

#### Scenario: Runtime not running
- **GIVEN** Foundry Local is not installed or not listening
- **WHEN** capabilities are queried
- **THEN** provider reports `RuntimeUnavailable`
- **AND** no connection retry loop runs indefinitely

### Requirement: Foundry settings
Users SHALL configure Foundry Local base URL and enable/disable the provider explicitly.

#### Scenario: Disabled in settings
- **GIVEN** `foundryLocal.enabled` is false
- **WHEN** routing providers are built
- **THEN** `FoundryLocalProvider` is omitted from the registry
