## ADDED Requirements

### Requirement: Provider and model selection settings
The system SHALL expose Speech-to-Text settings for provider (Automatic, Local, OpenRouter, Premium), model (Automatic or specific), language (Auto Detect or manual), prefer-local toggle, and automatic-fallback toggle.

#### Scenario: Speech-to-Text settings panel
- **WHEN** the user opens Settings → Speech-to-Text
- **THEN** the panel SHALL present provider, model, and language selectors with Automatic defaults and a link to Local Models management

#### Scenario: OpenRouter provider shows model list
- **WHEN** the user selects OpenRouter as provider
- **THEN** the model selector SHALL list Automatic, Nemotron 3.5 ASR 0.6B, Qwen3 ASR 0.6B, and Qwen3 ASR 1.7B

#### Scenario: Local provider shows installed ASR models
- **WHEN** the user selects Local as provider and Nemotron is installed
- **THEN** the model selector SHALL list Nemotron 3.5 ASR 0.6B as available

### Requirement: Language selection and hints
The system SHALL default language to Auto Detect and allow manual language overrides valid for the selected provider/model.

#### Scenario: User sets Spanish language hint
- **WHEN** the user selects Spanish as the transcription language
- **THEN** the transcription request SHALL include the hint to providers that support it

### Requirement: Privacy disclosure for transcription routing
The transcription UI SHALL indicate whether audio will be processed locally, through Plethora-managed infrastructure, or through the user's configured provider.

#### Scenario: Local provider selected
- **WHEN** the user selects Local provider or enables offline-only
- **THEN** the UI SHALL clearly state that audio will not leave the device

### Requirement: BYOK for transcription providers
Users SHALL be able to supply their own API keys for supported cloud transcription providers using existing secure credential storage.

#### Scenario: User configures OpenRouter BYOK
- **WHEN** the user adds an OpenRouter API key in settings
- **THEN** OpenRouter-backed transcription SHALL use that key via platform-secure storage

### Requirement: Usage and cost visibility
The system SHALL track transcription usage (audio seconds, provider, model, retries, estimated cost) and MAY display estimated provider cost to BYOK users.

#### Scenario: BYOK user views job progress
- **WHEN** a BYOK user transcribes a long recording
- **THEN** progress UI MAY display estimated transcription cost based on configured pricing metadata

### Requirement: Automatic fallback setting
Users SHALL be able to enable or disable automatic provider/model fallback independently of provider selection.

#### Scenario: Fallback disabled
- **WHEN** automatic fallback is disabled and the selected model fails
- **THEN** the system SHALL show an error rather than silently selecting another model
