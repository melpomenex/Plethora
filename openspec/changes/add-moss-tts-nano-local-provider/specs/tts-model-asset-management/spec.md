## ADDED Requirements

### Requirement: Model assets are downloaded on demand, never bundled

Model weights SHALL NOT be shipped inside the APK. They SHALL be downloaded on explicit user action and stored in the application data directory (`<filesDir>/tts/`).

The default model is KittenTTS Micro (~80–170 MB). Kokoro-82M (~335 MB) is optional. Each is downloaded independently; neither is required for the other.

#### Scenario: No download without consent

- **WHEN** the user selects the native provider for the first time
- **THEN** the system shows the model options, their sizes, the destination, and that they can be removed later, and downloads nothing until the user confirms

#### Scenario: Application size is unaffected

- **WHEN** the application is built for any platform
- **THEN** no model weights are present in the APK; only the sherpa-onnx native runtime is bundled

### Requirement: Download integrity and resumption

Downloads SHALL verify integrity before a model is used, and SHALL survive interruption without restarting from zero.

#### Scenario: Checksum verification

- **WHEN** a model finishes downloading
- **THEN** its SHA-256 digest is compared against the manifest, and on mismatch the file is deleted, the model marked not ready, and the failure reported with the model name

#### Scenario: Atomic placement

- **WHEN** a download is in progress
- **THEN** bytes are written to a temporary path and moved into place only after verification, so a partial file is never mistaken for a complete model

#### Scenario: Resuming after interruption

- **WHEN** a download is interrupted by app termination or connectivity loss and later retried
- **THEN** already-verified models are not re-downloaded, and a partially transferred model restarts that model only

#### Scenario: Progress reporting

- **WHEN** a download is running
- **THEN** the UI shows progress with bytes transferred against total and the current model name, updated via download-progress events

#### Scenario: Cancellation

- **WHEN** the user cancels an in-progress download
- **THEN** transfer stops, temporary files are removed, and any completed verified models are retained for a later resume

### Requirement: Failed and interrupted downloads recover cleanly

The system SHALL recover from failed, interrupted, or partially-written downloads without manual cleanup, so retrying always starts from a consistent state.

#### Scenario: Retry after a failed download

- **WHEN** a download failed (network error, checksum mismatch, or interruption) and the user retries
- **THEN** any partial or corrupt file for that model is removed before the retry begins, and the download proceeds from a clean state

#### Scenario: Corrupt model detected at load time

- **WHEN** a model's files were damaged externally and fail to load
- **THEN** the readiness check detects the failure, marks the model not ready, offers re-download, and falls back to System TTS in the meantime

### Requirement: Storage accounting and removal

The system SHALL make on-disk cost visible and reversible.

#### Scenario: Installed size shown

- **WHEN** the user views the model manager
- **THEN** the actual bytes on disk for each installed model are shown, along with the total

#### Scenario: Removing a model

- **WHEN** the user removes a model
- **THEN** all of that model's files are deleted, its disk usage returns to zero, the model becomes not installed, and any TTS default referencing it falls back to KittenTTS (if installed) or System TTS

#### Scenario: Insufficient free space

- **WHEN** free space is less than the download size plus a safety margin
- **THEN** the download is refused before starting, with the required and available amounts stated

#### Scenario: Space exhausted mid-download

- **WHEN** the device runs out of space during a download
- **THEN** the download fails cleanly, temporary files are removed, and the error explains the cause

### Requirement: Offline operation after download

Once a model is downloaded and verified, synthesis SHALL work fully offline, with no network request on the speak path.

#### Scenario: Offline speak after download

- **WHEN** a model is installed and the device has no network connection
- **THEN** synthesis and playback complete entirely on device, and no network call is made

### Requirement: Readiness is checked before use

The provider SHALL determine readiness from the assets actually present and verified on disk, so a partial or tampered install cannot reach synthesis.

#### Scenario: Readiness gate

- **WHEN** synthesis is requested with the active model missing or failing verification
- **THEN** synthesis falls back to System TTS and offers to download the model, rather than erroring during inference

#### Scenario: Assets removed externally

- **WHEN** model files are deleted outside the application and the provider is next used
- **THEN** the readiness check detects the absence and falls back to System TTS, rather than crashing during inference

#### Scenario: Manifest version change

- **WHEN** the application ships a manifest whose model versions differ from what is on disk
- **THEN** the stale models are reported as outdated with the option to update, and existing models keep working until the user updates
