## Purpose

Defines speech-to-text resolution, engine routing, and model quality ranking for audiobooks and podcasts.

## Requirements

### Requirement: Unified Speech Resolution for Audiobooks and Podcasts
The system SHALL resolve transcription requests for audiobooks and podcast episodes according to the unified Speech-to-Text configuration (`sttProvider`, `sttModel`, `preferLocal`, and `mode`), prioritizing installed local models (Cactus Whistle or Nemotron ASR) on supported hardware across desktop and mobile platforms.

#### Scenario: Local Nemotron prioritized when installed on desktop
- **WHEN** an audiobook or podcast transcription is initiated on desktop
- **AND** the local Nemotron 3.5 ASR model is installed and device meets performance requirements
- **AND** `sttProvider` is set to "local" or ("automatic" with `preferLocal` enabled)
- **THEN** the resolver SHALL return a successful resolution pointing to local Nemotron transcription
- **AND** the system SHALL NOT demand a Groq API key or fall back to Groq

#### Scenario: Local Whistle prioritized when installed across desktop or mobile
- **WHEN** an audiobook or podcast transcription is initiated on desktop or mobile
- **AND** the Cactus Whistle STT model is installed and ready
- **AND** `sttProvider` is set to "local", "automatic" with `preferLocal`, or Whistle is explicitly chosen
- **THEN** the resolver SHALL return a successful resolution pointing to local Whistle transcription
- **AND** the system SHALL NOT demand a Groq API key or fall back to cloud providers

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

### Requirement: Model Catalog and Quality Ranking for Cactus Whistle
The system SHALL register and rank Cactus Whistle (`cactus-whistle`, `whistle.cact`) as a first-class local speech profile in the model ranking table, recognizing Whistle across desktop and mobile platforms.

#### Scenario: Automatic fallback selects installed Whistle
- **WHEN** resolving the best installed local transcription model
- **AND** the local Whistle model is installed and verified on disk
- **AND** no larger model is explicitly forced
- **THEN** the resolver SHALL recognize Whistle as an active, runnable local speech model on both desktop and mobile

#### Scenario: Model identifier normalization for Whistle
- **WHEN** resolving installed models using either `cactus-whistle`, `whistle.cact`, or full HF identifier `hf:whistle:Cactus-Compute/whistle@main`
- **THEN** the backend and frontend resolvers SHALL resolve all forms to the installed Whistle model directory and executable engine route
