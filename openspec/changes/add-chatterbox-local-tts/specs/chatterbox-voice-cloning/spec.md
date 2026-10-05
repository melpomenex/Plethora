## Purpose

Enables users to record or import voice samples, compute speaker conditioning latent vectors via Chatterbox zero-shot encoder, and manage local voice profiles over standardized voice catalog endpoints.

## ADDED Requirements

### Requirement: Reference Audio Ingestion and Preprocessing
The system SHALL support reference audio capture through in-app microphone recording (5–15 seconds duration) and file import supporting WAV, MP3, M4A, and FLAC formats. Prior to speaker embedding extraction, the system SHALL apply preprocessing including RMS volume normalization, background noise gating, and trimming of leading and trailing silence.

#### Scenario: In-app microphone audio recording
- **WHEN** the user initiates recording in the Voice Cloning Studio, speaks for 8 seconds, and stops recording
- **THEN** the system SHALL capture the raw audio stream, present a waveform preview, and verify that the clip meets the duration requirement of 5 to 15 seconds

#### Scenario: Audio file import
- **WHEN** the user selects a supported external audio file (WAV, MP3, M4A, or FLAC)
- **THEN** the system SHALL decode the audio, validate that its duration is at least 3 seconds, and prepare it for preprocessing

#### Scenario: Audio sample preprocessing
- **WHEN** a valid audio sample is provided for voice cloning
- **THEN** the system SHALL normalize RMS amplitude to -20 dBFS, trim silence exceeding 200 ms, and produce a clean 24kHz single-channel intermediate sample

#### Scenario: Rejection of invalid audio sample
- **WHEN** an audio recording or file shorter than 3 seconds or with low SNR (unintelligible noise) is submitted
- **THEN** the system SHALL reject the sample with an explanatory error and prompt the user to re-record in a quiet environment

### Requirement: Zero-Shot Speaker Embedding Extraction via Standardized Voice API
The system SHALL support voice cloning by submitting preprocessed audio to the local voice endpoint `POST /v1/audio/voices` using standard multipart form-data. The daemon SHALL compute the speaker conditioning latent vector and register the voice without outbound network transmission.

#### Scenario: Successful latent vector computation via endpoint
- **WHEN** preprocessed audio is submitted to `POST /v1/audio/voices` with a voice name
- **THEN** the daemon SHALL compute the speaker latent representation within 2 seconds on GPU (or 5 seconds on CPU), save the tensor locally, and return a voice descriptor with a unique identifier

#### Scenario: Offline verification
- **WHEN** speaker embedding extraction is performed while network interfaces are disconnected
- **THEN** the extraction SHALL complete successfully with identical output, confirming zero remote dependencies

### Requirement: Voice Profile Storage and Metadata Management
The system SHALL persist voice profiles in local storage and expose them via `GET /v1/audio/voices`. Each voice profile SHALL record an identifier, display name, description, avatar/color tag, default playback speed multiplier, preferred content categories, and the path to the cached latent tensor file. The system SHALL provide controls to create, rename, preview, set as default, and delete voice profiles.

#### Scenario: Voice profile creation and audition
- **WHEN** speaker embedding extraction finishes and the user provides a profile name and default speed
- **THEN** the system SHALL save the profile record, enable a 1-click preview synthesis test phrase, and display the new voice in the voice selector

#### Scenario: Deleting a voice profile
- **WHEN** the user deletes a custom voice profile
- **THEN** the system SHALL remove the profile metadata from the database, delete the associated latent tensor file from disk, and revert any items using that voice to the default system voice

#### Scenario: Assigning a voice profile to a study collection
- **WHEN** the user configures a specific voice profile for a knowledge collection or tag
- **THEN** the system SHALL automatically select that voice profile when synthesizing extracts or queue items belonging to that collection
