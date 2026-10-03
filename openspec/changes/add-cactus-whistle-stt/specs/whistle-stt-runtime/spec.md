## Purpose

Provides high-speed, offline on-device speech-to-text transcription powered by Cactus Whistle and the Cactus Needle native engine across desktop and mobile platforms.

## ADDED Requirements

### Requirement: Cross-Platform Needle Engine Provisioning
The application SHALL bundle and provision the native Cactus Needle engine (`needle` / `needle.exe`) as an external binary sidecar across all supported desktop platforms (Linux x86_64, Linux ARM64, macOS Apple Silicon, Windows x64, and Windows ARM64) and provide native engine execution on Android (arm64, armv7).

#### Scenario: Provisioning desktop sidecar on install or setup
- **WHEN** application sidecars are provisioned or verified on a supported desktop platform
- **THEN** the system SHALL verify that the target-specific `needle` binary exists in the application binary directory, has executable permissions, and responds to `--help`

#### Scenario: Verifying sidecar availability on unsupported platform
- **WHEN** the host platform does not match any published Needle engine target
- **THEN** the system SHALL report Whistle STT as unavailable and gracefully fall back to alternative local or cloud providers

### Requirement: Cactus Whistle Model Management
The system SHALL support downloading, verifying, and managing the Cactus Whistle model artifact (`whistle.cact`, 16.9 MB) via Hugging Face model management on desktop and on-device model registry on Android.

#### Scenario: Downloading Whistle model from Hugging Face
- **WHEN** a user initiates download of the Whistle STT model
- **THEN** the system SHALL download `whistle.cact` from `Cactus-Compute/whistle`
- **AND** verify its file size and integrity before registering it as ready for transcription

#### Scenario: Deleting or resetting Whistle model
- **WHEN** a user deletes the installed Whistle model
- **THEN** the system SHALL safely remove the cached `.cact` file
- **AND** update model listing and transcription routing to reflect that Whistle is no longer installed

### Requirement: Standalone Audio Transcription via Needle CLI
The backend transcription engine SHALL execute audio transcription by invoking the provisioned `needle` binary with `--model <path-to-whistle.cact> --audio <wav-file>`, parsing the emitted JSON output into timed transcript segments.

#### Scenario: Transcribing audio with detected language
- **WHEN** a transcription job is executed with Whistle and no explicit language override is provided
- **THEN** the system SHALL invoke the `needle` binary with `--model whistle.cact --audio <wav>`
- **AND** parse the returned JSON containing text, detected language, and timing metrics into structured transcript segments

#### Scenario: Transcribing audio with word-level timestamps
- **WHEN** transcription is requested with word-level timing enabled
- **THEN** the system SHALL pass `--audio-word-timestamps` to the `needle` binary
- **AND** convert word-level timestamp entries (`start`, `end`, `word`, `probability`) into playback-synchronized transcript tokens

#### Scenario: Execution error or process failure handling
- **WHEN** the `needle` process fails or exits with a non-zero exit code
- **THEN** the system SHALL capture stderr or the error JSON
- **AND** surface a structured error message indicating the failure cause without crashing the transcription queue

### Requirement: Android On-Device Whistle Transcription
The Android STT plugin (`plethora-android-stt`) SHALL register the Whistle model manifest in its model registry, download the `.cact` weights to private app storage, and execute transcription using the native Needle engine.

#### Scenario: Transcribing podcast or audiobook on Android with Whistle
- **WHEN** an audiobook or podcast episode is transcribed on an Android device with Whistle installed
- **THEN** the Android STT service SHALL process audio through the native Needle engine
- **AND** stream progress updates and return final segments without requiring network access or cloud API keys
