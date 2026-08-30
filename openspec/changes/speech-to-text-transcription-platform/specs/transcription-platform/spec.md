## ADDED Requirements

### Requirement: Provider-independent transcription interface
The system SHALL expose all speech-to-text functionality through a common `TranscriptionProvider` interface that supports file transcription, optional native streaming, cancellation, and capability advertisement without coupling UI or feature code to any single vendor API.

#### Scenario: Feature requests transcription without knowing provider
- **WHEN** a feature invokes `TranscriptionService.transcribe()` with audio input and provider/model settings
- **THEN** the service SHALL select and invoke an appropriate provider implementation without the caller referencing OpenRouter, Groq, Gemini, Deepgram, or local engine APIs directly

#### Scenario: Provider advertises capabilities
- **WHEN** the system queries a provider's capabilities
- **THEN** the provider SHALL return structured capability flags including batch, streaming, pseudo-streaming, segment/word timestamps, diarization, language detection, vocabulary boosting, and supported languages

### Requirement: Normalized transcription results
All providers SHALL normalize responses into a common `TranscriptionResult` format containing text, optional language, ordered segments with start/end timestamps, optional word-level timing, optional speaker metadata, and provider metadata (`providerId`, `modelId`).

#### Scenario: Cloud provider returns vendor-specific format
- **WHEN** an OpenRouter ASR provider completes a transcription request
- **THEN** the system SHALL convert the response into normalized segments with millisecond timestamps suitable for search, highlighting, flashcard generation, and audio seek

#### Scenario: Local Nemotron returns native segments
- **WHEN** local Nemotron transcription completes
- **THEN** the normalized result structure SHALL be identical to cloud results so downstream features require no provider-specific handling

### Requirement: Normalized transcription errors
The system SHALL map provider-specific failures to normalized error codes including `AUTH_FAILED`, `MODEL_NOT_INSTALLED`, `MODEL_LOAD_FAILED`, `DEVICE_UNSUPPORTED`, `OUT_OF_MEMORY`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `NETWORK_FAILED`, `UNSUPPORTED_FORMAT`, `UNSUPPORTED_LANGUAGE`, `TIMEOUT`, `CANCELLED`, and `UNKNOWN`.

#### Scenario: Rate limit from cloud provider
- **WHEN** a provider returns HTTP 429
- **THEN** the system SHALL surface `RATE_LIMITED` to callers and SHALL NOT expose raw provider error bodies in ordinary UI

### Requirement: Audio preprocessing before transcription
The transcription service SHALL normalize audio when necessary (resampling, channel conversion, MIME normalization, chunking) without destructively modifying the user's original recording.

#### Scenario: Unsupported codec for cloud upload
- **WHEN** imported audio uses a codec the selected cloud provider cannot accept
- **THEN** the service SHALL attempt local format conversion before upload or return an actionable `UNSUPPORTED_FORMAT` error

### Requirement: Central service API boundary
User-facing features SHALL interact with transcription only through `TranscriptionService` and feature hooks, not provider implementations directly.

#### Scenario: Import audio dialog starts transcription
- **WHEN** the user confirms transcription on an imported audio file
- **THEN** the dialog SHALL call the transcription service layer, not a Groq- or OpenRouter-specific module

### Requirement: Streaming transcription session interface
Providers supporting native or pseudo streaming SHALL implement `StreamingTranscriptionSession` with `pushAudio`, `close`, `cancel`, and callbacks for partial, final, and error events.

#### Scenario: Realtime local Nemotron session
- **WHEN** a feature starts a streaming transcription session with a capable local model
- **THEN** partial transcripts SHALL be delivered through the session callback interface without bypassing `TranscriptionService`
