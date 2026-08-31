## ADDED Requirements

### Requirement: Accurate Runtime Telemetry Across Local STT Engines
The system SHALL capture and expose the ground-truth execution backend and device that actually executes local transcription inference, replacing static heuristics or assumed driver capabilities.

#### Scenario: Verified CUDA execution reporting
- **WHEN** Nemotron or Whisper runs on an NVIDIA GPU via CUDA
- **THEN** progress events and job status payloads SHALL report backend as "cuda" and device name matching the active GPU (e.g., "NVIDIA GeForce RTX 2060 SUPER")
- **AND** the UI SHALL display the device and backend badge on the active transcription item

#### Scenario: Ground-truth Whisper backend detection
- **WHEN** Whisper runs on macOS with Metal or Linux with Vulkan/CUDA
- **THEN** the system SHALL verify backend initialization from whisper execution logs
- **AND** SHALL NOT infer GPU presence merely from the existence of `libggml-vulkan.so` on disk

#### Scenario: Real-time fallback indicator
- **WHEN** an active transcription job falls back from an accelerator to CPU
- **THEN** the status payload SHALL update the active backend to "cpu"
- **AND** the UI SHALL display a non-modal indicator stating that processing is continuing on CPU
