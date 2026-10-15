## ADDED Requirements

### Requirement: OpenRouter ASR provider integration
The system SHALL support cloud transcription through OpenRouter using configuration-driven model identifiers, reusing existing OpenRouter credential storage and never logging API keys.

#### Scenario: Nemotron default transcription
- **WHEN** OpenRouter cloud transcription runs with automatic model selection
- **THEN** the system SHALL use the configured default model (initially `nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b`) via OpenRouter's speech-to-text interface

#### Scenario: Missing OpenRouter credentials
- **WHEN** cloud transcription is requested but no OpenRouter key is available and BYOK is required
- **THEN** the system SHALL return `AUTH_FAILED` or prompt the user to configure credentials without leaking key material

### Requirement: User-selectable OpenRouter STT models
When OpenRouter is selected as provider, the system SHALL expose a model selector including Automatic, Nemotron 3.5 ASR 0.6B, Qwen3 ASR 0.6B, and Qwen3 ASR 1.7B.

#### Scenario: User selects Qwen3 ASR 1.7B
- **WHEN** the user selects Qwen3 ASR 1.7B in OpenRouter model settings
- **THEN** subsequent OpenRouter transcriptions SHALL use that model unless automatic fallback changes provider on failure

### Requirement: Dynamic OpenRouter STT model discovery
The system SHOULD discover compatible OpenRouter STT models from provider capability metadata and SHALL filter to models supporting audio/transcription input.

#### Scenario: Catalog refresh discovers new ASR model
- **WHEN** OpenRouter publishes a new audio-capable model matching the capability filter
- **THEN** the model MAY appear in the STT selector without a code change, subject to curated override rules

#### Scenario: Incomplete provider metadata
- **WHEN** a known ASR model lacks complete OpenRouter metadata
- **THEN** the curated override list SHALL still surface the model in the selector

### Requirement: OpenRouter fallback models
The system SHALL support Qwen3 ASR 0.6B and 1.7B via OpenRouter as configurable fallback providers.

#### Scenario: Nemotron unavailable
- **WHEN** Nemotron returns provider unavailable and fallback is permitted
- **THEN** the system SHALL attempt Qwen3 ASR 0.6B and then Qwen3 ASR 1.7B

### Requirement: Pseudo-streaming via VAD chunking
For near-live transcription without native streaming, the system SHALL combine microphone capture, voice-activity detection, sequential OpenRouter STT requests, and transcript reconciliation.

#### Scenario: Live pseudo-streaming session
- **WHEN** pseudo-streaming mode is active with speech detected
- **THEN** the system SHALL submit utterance-bounded audio chunks (target 2–6 seconds) to OpenRouter STT and merge results without duplicate boundary text

### Requirement: OpenRouter failure normalization
OpenRouter-specific errors (model unavailable, rate limits, balance exhaustion) SHALL be normalized before reaching UI or job state.

#### Scenario: OpenRouter model unavailable
- **WHEN** OpenRouter reports the configured ASR model is unavailable
- **THEN** the system SHALL map the failure to `PROVIDER_UNAVAILABLE` and attempt configured fallback if allowed
