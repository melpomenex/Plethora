## Purpose

Manages the lifecycle, hardware acceleration backend detection, health monitoring, and standardized OpenAI-compatible streaming synthesis API of the isolated Chatterbox TTS daemon.

## ADDED Requirements

### Requirement: Chatterbox Sidecar Process Lifecycle Management
The system SHALL manage the execution lifecycle of an isolated background Chatterbox TTS daemon process. The daemon SHALL be spawned on-demand upon the first text-to-speech request or explicit user enablement in Settings, and SHALL be terminated cleanly when the application exits. If the daemon process crashes or terminates unexpectedly, the system SHALL automatically restart the process without losing UI playback state.

#### Scenario: Lazy startup upon first synthesis request
- **WHEN** the user initiates audio playback and the Chatterbox daemon is not running
- **THEN** the system SHALL launch the daemon process in the background, establish connectivity to its local HTTP server, and proceed with synthesis once warm

#### Scenario: Health check status reporting
- **WHEN** the system polls the daemon's `GET /health` endpoint
- **THEN** the daemon SHALL respond with HTTP 200 containing status metrics including active hardware backend, memory footprint, and model warm-up status

#### Scenario: Daemon auto-recovery after unexpected termination
- **WHEN** the running daemon process terminates abnormally during application runtime
- **THEN** the system SHALL detect process exit, restart the daemon within 2 seconds, and notify the playback queue to retry pending requests without crashing the application

#### Scenario: Clean daemon shutdown on application exit
- **WHEN** the Plethora desktop application initiates shutdown
- **THEN** the system SHALL send a termination signal to the sidecar daemon and wait up to 3 seconds for clean exit before forcibly killing the process

### Requirement: Hardware Acceleration Detection and Fallback
The system SHALL auto-detect the host machine's hardware capabilities and initialize Chatterbox with the fastest supported execution provider: NVIDIA CUDA 12.x, Apple Silicon Metal (MPS), or AMD ROCm. If no compatible GPU accelerator is detected, the system SHALL fall back to multi-threaded CPU execution with INT8 quantization. If available host memory or VRAM is less than 4 GB, the system SHALL notify the user of potential latency constraints.

#### Scenario: GPU acceleration enabled when supported hardware is present
- **WHEN** the daemon starts on a host equipped with supported NVIDIA or Apple Silicon hardware
- **THEN** the daemon SHALL load model weights into GPU memory using CUDA or Metal and report the accelerated provider in the health check

#### Scenario: CPU fallback when no GPU is detected
- **WHEN** the daemon starts on a machine without supported GPU accelerators
- **THEN** the daemon SHALL initialize the inference session using CPU execution with INT8 dynamic quantization and log the fallback

#### Scenario: Low memory advisory
- **WHEN** system checks detect less than 4 GB of free system memory or VRAM prior to model load
- **THEN** the system SHALL present a non-blocking notification in the audio settings suggesting lightweight synthesis or alerting to potential latency

### Requirement: Standardized OpenAI-Compatible Streaming Synthesis API
The system SHALL expose a standardized OpenAI-compatible HTTP API serving `POST /v1/audio/speech`, `GET /v1/models`, and `POST /v1/audio/voices`. The speech endpoint SHALL accept `{ model, input, voice, response_format, speed }` and stream generated audio chunks as 24kHz 16-bit PCM or Opus frames with a Time-to-First-Audio (TTFA) of 450 ms or less on accelerated hardware.

#### Scenario: Gapless streaming audio generation via standard endpoint
- **WHEN** a synthesis request is sent to `POST /v1/audio/speech` with valid input text and voice identifier
- **THEN** the daemon SHALL stream chunked audio bytes with TTFA under 450 ms and Real-Time Factor (RTF) of 0.35 or lower

#### Scenario: Models enumeration via standard endpoint
- **WHEN** a request is sent to `GET /v1/models`
- **THEN** the daemon SHALL return an OpenAI-compatible list of available models and supported features including voice cloning

#### Scenario: Immediate cancellation of active streaming request
- **WHEN** the client terminates the HTTP connection or sends a cancellation signal during an active synthesis stream
- **THEN** the daemon SHALL abort active inference within 50 ms to free compute resources

### Requirement: Model Asset Management and Integrity Verification
The system SHALL store Chatterbox model assets (weights, vocoder, and configuration $\le 1.2\text{ GB}$) in the application data directory. The system SHALL verify file integrity via SHA-256 checksums before loading the model into memory. If model assets are absent or corrupted, the system SHALL initiate an on-demand download with progress reporting.

#### Scenario: Missing model assets trigger download workflow
- **WHEN** the user enables Chatterbox local TTS and required model files are not found on disk
- **THEN** the system SHALL prompt the user to download model assets and stream byte-level download progress events to the UI

#### Scenario: Checksum verification detects corruption
- **WHEN** model files fail SHA-256 verification during startup
- **THEN** the system SHALL quarantine corrupted files, notify the user, and offer a one-click redownload
