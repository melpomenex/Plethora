## MODIFIED Requirements

### Requirement: Unified Speech Resolution for Audiobooks and Podcasts
The system SHALL resolve transcription requests for audiobooks and podcast episodes according to the unified Speech-to-Text configuration (`sttProvider`, `sttModel`, `preferLocal`, and `mode`), prioritizing the local Nemotron ASR model when installed on supported, capable hardware, while delegating compute accelerator selection to the centralized compute backend selector.

#### Scenario: Local Nemotron prioritized when installed on desktop
- **WHEN** an audiobook or podcast transcription is initiated on desktop
- **AND** the local Nemotron 3.5 ASR model is installed and device meets performance requirements
- **AND** `sttProvider` is set to "local" or ("automatic" with `preferLocal` enabled)
- **THEN** the resolver SHALL return a successful resolution pointing to local Nemotron transcription
- **AND** the system SHALL NOT demand a Groq API key or fall back to Groq

#### Scenario: Explicit Groq provider selection is honored
- **WHEN** an audiobook or podcast transcription is initiated
- **AND** the user has explicitly selected "groq" as their provider or configured an explicit cloud routing
- **THEN** the resolver SHALL route transcription to Groq cloud services

#### Scenario: Missing Groq key is surfaced only when cloud Groq is required
- **WHEN** transcription resolution selects Groq (e.g. on mobile without on-device models, or explicit Groq selection)
- **AND** no Groq API key is configured in settings
- **THEN** the resolver SHALL return a failed resolution indicating `missing-groq-key` with guidance to settings

#### Scenario: Compute backend failure maintains local provider isolation
- **WHEN** local transcription encounters an accelerator failure (e.g. CUDA OOM or missing GPU runtime)
- **AND** the job was resolved to local transcription
- **THEN** the system SHALL fall back to local CPU execution within the local provider
- **AND** SHALL NOT switch the provider to Groq or any cloud service without explicit user configuration
