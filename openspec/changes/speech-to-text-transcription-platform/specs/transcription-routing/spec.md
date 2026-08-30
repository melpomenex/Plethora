## ADDED Requirements

### Requirement: Provider-category routing
The system SHALL route transcription according to user-selected provider category: Automatic, Local, OpenRouter, or Premium/Advanced, combined with model selection and privacy overrides.

#### Scenario: Automatic mode with local Nemotron installed and adequate performance
- **WHEN** the user selects Automatic provider, prefer-local is enabled, Nemotron is installed locally, and device capability is Usable or better
- **THEN** the router SHALL prefer local Nemotron before attempting cloud providers

#### Scenario: Explicit OpenRouter selection skips local inference
- **WHEN** the user selects OpenRouter as provider with a specific model
- **THEN** the router SHALL use cloud OpenRouter only and SHALL NOT run local inference even if Nemotron is installed

#### Scenario: Offline-only never uploads audio
- **WHEN** the user enables offline-only or selects Local provider with offline guarantee
- **THEN** the router SHALL use only local providers and SHALL NOT send audio to any cloud provider even if local transcription fails

### Requirement: Capability-aware fallback
When a provider fails due to transient or recoverable errors and automatic fallback is enabled, the system SHALL attempt fallback providers that satisfy capability, privacy, and cost constraints.

#### Scenario: Default cloud provider unavailable
- **WHEN** Nemotron via OpenRouter fails with timeout or provider unavailable and fallback is enabled
- **THEN** the system SHALL attempt Qwen3 ASR 0.6B, then Qwen3 ASR 1.7B, when inexpensive cloud fallback is permitted

#### Scenario: Explicit model selection with fallback disabled
- **WHEN** the user selected OpenRouter Qwen3 ASR 1.7B and disabled automatic fallback
- **THEN** the system SHALL surface an error on failure rather than silently substituting another model

#### Scenario: Fallback respects billing guardrails
- **WHEN** fallback would escalate from an inexpensive provider to a premium provider
- **THEN** the system SHALL NOT silently perform the escalation unless the user explicitly selected Premium or confirmed premium usage

### Requirement: Cost-class protection in automatic fallback
Automatic fallback SHALL NOT escalate from a low-cost provider class to a significantly more expensive provider class without explicit user consent.

#### Scenario: Nemotron fails during automatic transcription
- **WHEN** inexpensive cloud Nemotron fails and fallback is permitted
- **THEN** the system MAY fall back to other inexpensive OpenRouter ASR models but SHALL NOT fall back to premium providers without user selection

### Requirement: Retry policy for transient failures
The system SHALL retry transient failures (HTTP 429, 502, 503, network errors, timeouts) with exponential backoff and jitter, and SHALL NOT retry auth failures, unsupported formats, invalid keys, or user cancellation.

#### Scenario: Transient network failure
- **WHEN** a cloud transcription request fails with a network timeout
- **THEN** the system SHALL retry up to the configured limit before attempting fallback or marking the job failed

### Requirement: Configurable default provider and model
The application's preferred default ASR provider, model, and fallback chain SHALL be changeable through configuration without refactoring feature code.

#### Scenario: Remote configuration updates OpenRouter default model
- **WHEN** configuration changes `stt.openrouter.defaultModel` from Nemotron to Qwen3 0.6B
- **THEN** Automatic OpenRouter selection SHALL use the new default on subsequent requests

### Requirement: Provider health deprioritization
The system MAY temporarily deprioritize providers after repeated failures and SHALL restore them after successful health checks.

#### Scenario: Repeated Nemotron failures
- **WHEN** Nemotron fails repeatedly within a health window
- **THEN** the router SHALL deprioritize Nemotron for subsequent Automatic routing until a successful health check

### Requirement: Shared logical model identity across execution targets
Cloud and local Nemotron 3.5 ASR 0.6B SHALL be presented as the same logical model family with different execution targets (OpenRouter vs local runtime).

#### Scenario: User sees Nemotron in settings
- **WHEN** the user views model options for Automatic or Local provider
- **THEN** Nemotron 3.5 ASR 0.6B SHALL appear with consistent display naming regardless of whether it runs locally or via OpenRouter
