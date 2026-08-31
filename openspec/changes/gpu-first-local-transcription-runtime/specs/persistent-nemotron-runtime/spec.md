## ADDED Requirements

### Requirement: Persistent Nemotron Runtime Lifecycle
The system SHALL manage Nemotron 3.5 ASR streaming inference through a persistent session architecture that keeps the model loaded across audio chunks, avoiding process-per-chunk reinitialization.

#### Scenario: Transcribing long audio with persistent Nemotron session
- **WHEN** transcribing a multi-minute audio file using Nemotron 3.5 ASR
- **THEN** the system SHALL spawn the `sherpa-online` runtime once with the designated compute provider
- **AND** feed successive audio chunks into the running session via standard input or streaming IPC
- **AND** receive incremental timestamped transcript segments as chunks are processed

#### Scenario: Nemotron CUDA session initialization
- **WHEN** Nemotron transcription starts on a system with a verified CUDA runtime
- **AND** compute mode is set to AUTO or GPU_PREFERRED
- **THEN** `sherpa-online` SHALL be launched with `--provider=cuda` and `--device=<device_id>`
- **AND** the runtime SHALL confirm successful CUDA execution before marking the session active

#### Scenario: VRAM reclamation on session termination
- **WHEN** a transcription job completes or is cancelled
- **THEN** the persistent `sherpa-online` process SHALL be cleanly terminated
- **AND** all associated GPU memory SHALL be released within 5 seconds

### Requirement: Streaming Chunk Protocol for Nemotron Sidecar
The Nemotron runner SHALL support streaming audio chunks into the sidecar process while preserving monotonic segment timestamps across chunk boundaries.

#### Scenario: Continuous segment timestamp alignment
- **WHEN** audio chunks $0, 1, 2$ are fed sequentially to the persistent Nemotron session
- **THEN** emitted segments SHALL have start and end timestamps continuous with the overall audio timeline
- **AND** silence or chunk padding SHALL NOT induce timestamp drift or repeated utterances
