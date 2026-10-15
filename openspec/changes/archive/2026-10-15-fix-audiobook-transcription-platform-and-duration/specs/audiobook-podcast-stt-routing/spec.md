## MODIFIED Requirements

### Requirement: Unified Speech Resolution for Audiobooks and Podcasts
The system SHALL resolve transcription requests for audiobooks and podcast episodes according to the unified Speech-to-Text configuration (`sttProvider`, `sttModel`, `preferLocal`, and `mode`), prioritizing the local Nemotron ASR model when installed on supported, capable hardware.

#### Scenario: Local Nemotron prioritized when installed on desktop
- **WHEN** an audiobook or podcast transcription is initiated on a desktop Tauri app
- **AND** the authoritative native OS platform is not Android or iOS, even if the webview user agent contains mobile markers
- **AND** the local Nemotron 3.5 ASR model is installed and device meets performance requirements
- **AND** `sttProvider` is set to "local" or ("automatic" with `preferLocal` enabled)
- **THEN** the resolver SHALL return a successful resolution pointing to local Nemotron transcription
- **AND** the system SHALL NOT demand an on-device mobile STT model or show mobile-only guidance
- **AND** the system SHALL NOT demand a Groq API key or fall back to Groq

#### Scenario: Explicit Groq provider selection is honored
- **WHEN** an audiobook or podcast transcription is initiated
- **AND** the user has explicitly selected "groq" as their provider or configured an explicit cloud routing
- **THEN** the resolver SHALL route transcription to Groq cloud services

#### Scenario: Missing Groq key is surfaced only when cloud Groq is required
- **WHEN** transcription resolution selects Groq (e.g. on mobile without on-device models, or explicit Groq selection)
- **AND** no Groq API key is configured in settings
- **THEN** the resolver SHALL return a failed resolution indicating `missing-groq-key` with guidance to settings

### Requirement: Model Catalog and Quality Ranking for Nemotron
The system SHALL register and rank Nemotron ASR (`nemotron-3.5-asr-0.6b` and Hugging Face model identifiers) as a first-class local speech profile in the model ranking table, so automatic model selection and model verification recognize Nemotron when installed.

#### Scenario: Automatic fallback selects installed Nemotron
- **WHEN** resolving the best installed local transcription model
- **AND** the local Nemotron model is installed and verified on disk
- **AND** no legacy preferred Whisper model is explicitly designated
- **THEN** the resolver SHALL select the installed Nemotron model over fallback Whisper models on capable systems

#### Scenario: Model identifier normalization
- **WHEN** resolving installed models using either the logical key `nemotron-3.5-asr-0.6b`, repo identifier `nvidia/nemotron-3.5-asr-0.6b`, or full HF identifier `hf:nemotron-asr:nvidia/nemotron-3.5-asr-0.6b@main`
- **THEN** the backend and frontend resolvers SHALL resolve all three forms to the installed Nemotron model contract and directory

### Requirement: Backend Podcast Engine Dispatch for Nemotron
The backend podcast transcription runner (`run_transcription_job` / `transcribe_podcast_episode`) SHALL resolve models via the Hugging Face model registry in addition to the legacy Whisper model manager, and SHALL dispatch execution through `stt_route_for_model` and `engine.transcribe_route(...)`.

#### Scenario: Transcribing podcast episode via local Nemotron
- **WHEN** `transcribe_podcast_episode` is invoked with a Nemotron model identifier
- **THEN** the backend SHALL verify the model from the HF registry or pinned catalog
- **AND** the backend SHALL execute transcription via the Nemotron GGUF engine
- **AND** the backend SHALL emit progress and persist the resulting segments with timestamps

### Requirement: Standalone Audiobook Transcription Dispatch
The audiobook transcription API and backend handler (`generate_audiobook_transcript` and `generateTranscript`) SHALL execute transcription with local Nemotron when resolved, returning valid timed segments and updating the database.

#### Scenario: Generating audiobook transcript with Nemotron
- **WHEN** `generateTranscript` is called for an audiobook file with local Nemotron resolved
- **THEN** the system SHALL transcribe the audiobook using the local Nemotron engine
- **AND** return an `AudiobookTranscript` containing formatted segments and full text without invoking Groq APIs

### Requirement: Large audiobook Groq requests are chunked safely
The system SHALL transcribe a local audiobook selected for Groq using multiple independently decodable uploads whenever the source cannot fit within Groq's per-request byte limit, preserving absolute timestamps and cleaning up temporary chunks after success or failure.

#### Scenario: Long M4B is chunked before upload
- **WHEN** a local `.m4b` audiobook is routed to Groq and exceeds the conservative upload threshold
- **THEN** the system SHALL decode/re-encode or otherwise produce independently decodable chunks below the provider limit
- **AND** SHALL upload no single chunk at or above the provider limit
- **AND** SHALL offset each returned segment by its chunk start time before persistence

#### Scenario: Chunking failure is actionable
- **WHEN** the app cannot safely split a large audiobook into independently decodable chunks
- **THEN** the system SHALL not upload arbitrary container byte ranges
- **AND** SHALL report that safe Groq chunking failed with guidance to use local/on-device transcription or a supported provider
