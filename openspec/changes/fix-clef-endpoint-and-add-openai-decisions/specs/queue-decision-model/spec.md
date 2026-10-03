## Purpose

Defines the decision-model provider interface, endpoint resolution, response envelope handling, connection probing, and model options for adaptive queue ranking.

## ADDED Requirements

### Requirement: REST responses wrapped in result envelopes are unwrapped

The system SHALL unwrap decision model responses containing top-level `result` envelopes (such as Cloudflare Workers AI) to access `answers`, `model`, and `usage` data seamlessly alongside standard top-level responses.

#### Scenario: Cloudflare Clef REST envelope unwrapped
- **WHEN** Cloudflare Workers AI responds with `{ "result": { "answers": { ... } }, "success": true }`
- **THEN** the probe and ranking evaluation SHALL extract answers from `result.answers`
- **AND** the probe SHALL report `ok` rather than `no-answer`

#### Scenario: Standard top-level answers format parsed
- **WHEN** a provider (such as TypeSafe Jev or Laya) responds with top-level `{ "answers": { ... } }`
- **THEN** the system SHALL parse `answers` directly without error

### Requirement: OpenRouter decision endpoint resolves without duplicated path segments

The system SHALL resolve the OpenRouter System One decision endpoint URL to `https://openrouter.ai/api/v1/systemone` without duplicate `/v1` segments.

#### Scenario: Default OpenRouter System One URL resolution
- **WHEN** OpenRouter decisions provider is selected with default configuration
- **THEN** the resolved URL SHALL be `https://openrouter.ai/api/v1/systemone`
- **AND** the URL SHALL NOT contain `/v1/v1/`

### Requirement: Cloudflare Clef supports 27B and 9B model variants

The system SHALL support selecting between Cloudflare Clef models (`@cf/cloudflare/clef` 27B and `@cf/cloudflare/clef-flash` 9B) with appropriate default resolution and payload routing.

#### Scenario: Clef model variant specified
- **WHEN** a user selects a Clef model variant or uses default Clef
- **THEN** the request URL SHALL contain the specified model path in the endpoint URL
- **AND** the bare model name SHALL be sent in the request body

### Requirement: OpenAI decision models are supported as a decision provider

The system SHALL support an OpenAI decision provider option (`openai-decisions`) targeting `https://api.openai.com/v1/decisions` with model `gpt-6-luna`, reusing the existing `openai` keychain slot and enforcing the remote privacy opt-in.

#### Scenario: OpenAI decision model configured with valid API key
- **WHEN** a user selects OpenAI decision models and has an OpenAI API key stored in keychain
- **THEN** the system SHALL recognize the configuration as ready once remote opt-in is granted
- **AND** probe and ranking requests SHALL be routed to `https://api.openai.com/v1/decisions` with bearer authentication

#### Scenario: OpenAI decision model requires remote opt-in
- **WHEN** OpenAI decision model is selected but `allowRemoteDecisionModel` is false
- **THEN** setup gaps SHALL report `allowRemoteDecisionModel`
- **AND** no network request SHALL leave the device

### Requirement: Key management commands handle all registered providers safely

The system's native key commands `set_api_key` and `remove_api_key` SHALL safely persist and delete credentials for all registered providers without panicking.

#### Scenario: Saving key for decision provider
- **WHEN** `set_api_key` is invoked for `clef`, `jev`, or `openai`
- **THEN** the key SHALL be stored in the OS keychain without a panic

#### Scenario: Removing key for decision provider
- **WHEN** `remove_api_key` is invoked for `clef`, `jev`, or `openai`
- **THEN** the key SHALL be removed from the OS keychain without a panic
