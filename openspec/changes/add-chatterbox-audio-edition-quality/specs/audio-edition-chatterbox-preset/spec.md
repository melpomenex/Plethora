# audio-edition-chatterbox-preset Specification

## Purpose
Specifies the Expressive / Chatterbox Local quality preset for Audio Edition creation: preset-to-provider mapping onto the `openai-compatible` adapter and a local Chatterbox Turbo service, WAV-format requests, service health pre-flight with recovery guidance, per-request chunk caps with serialized generation, and speed-control gating.

## ADDED Requirements

### Requirement: Expressive Chatterbox Quality Preset
The system SHALL offer an `expressive` quality preset labeled "Chatterbox Local" (free, local GPU narration with zero-shot voice cloning) alongside the existing Fast, Natural, and Best presets, mapping to provider `openai-compatible`, model `chatterbox-turbo`, and the first enumerated voice (fallback `"default"`), without changing the default preset or existing preset mappings.

#### Scenario: Expressive preset selected
- **WHEN** the user selects the Expressive tile in the Create Audio Edition dialog
- **THEN** the system SHALL set provider `openai-compatible`, model `chatterbox-turbo`, and a valid Chatterbox voice, keeping Advanced settings in sync

#### Scenario: Existing presets untouched
- **WHEN** the user selects Fast, Natural, or Best
- **THEN** the system SHALL apply the pre-existing Pocket / OpenRouter / ElevenLabs mappings exactly as before

### Requirement: Advanced Provider Entry
The system SHALL list the Chatterbox local service in the Advanced provider dropdown and resolve its voices through the `openai-compatible` adapter's enumeration, with a static fallback roster so the dropdown is never empty when the service is down.

#### Scenario: Provider picked from Advanced settings
- **WHEN** the user picks the Chatterbox entry in Advanced settings
- **THEN** the system SHALL configure model `chatterbox-turbo` and populate Voice Selection from enumerated voices (or the fallback roster if enumeration fails)

### Requirement: WAV-Format Requests
The system SHALL request `response_format: "wav"` for audition and generation on the Chatterbox path, matching the local service's WAV-only output.

#### Scenario: Audition on Chatterbox path
- **WHEN** the user auditions a Chatterbox voice
- **THEN** the system SHALL send the synthesis request with WAV format and play the returned 24 kHz WAV bytes

### Requirement: Service Health Pre-flight
The system SHALL check the local service's `GET /health` before Chatterbox audition or generation, and on failure show an inline error with the exact recovery command instead of hanging or buffering indefinitely.

#### Scenario: Service stopped
- **WHEN** the user clicks Audition or Create with the Chatterbox service stopped
- **THEN** the system SHALL display the recovery command (`systemctl --user start chatterbox-tts`) and SHALL NOT start a hung generation job

### Requirement: Chunked Serialized Generation
The system SHALL split Chatterbox section text into requests of at most ~500 characters and issue them strictly one at a time (queue depth 1, no concurrent syntheses) to bound inference latency and GPU memory on 8 GB cards. (500, not 1000: the server's s3gen attention kernels segfaulted on a ~976-char request, killing the whole service; the server enforces the same cap itself as defense in depth.)

#### Scenario: Long chapter generation
- **WHEN** a chapter exceeds the per-request character cap
- **THEN** the system SHALL complete it as sequential chunk audios that concatenate in section order, with at most one request in flight at any moment

### Requirement: Speed Control Gating
The system SHALL disable the speed slider with explanatory text on the Chatterbox path, since Chatterbox Turbo exposes no speed parameter, while leaving the slider fully functional for all other providers.

#### Scenario: Speed slider on Chatterbox path
- **WHEN** the Chatterbox provider is active
- **THEN** the system SHALL render the speed control disabled with a note that speed is unsupported, and SHALL NOT send a speed value to the service
