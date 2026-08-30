## ADDED Requirements

### Requirement: Nemotron in existing local model manager
NVIDIA Nemotron 3.5 ASR Streaming Multilingual 0.6B SHALL be installable through Plethora's existing Local Models / HF model manager UX with the same download, progress, verification, storage, removal, and update flows as other local models.

#### Scenario: User installs Nemotron from Local Models
- **WHEN** the user opens Settings → Local Models and taps Install on Nemotron 3.5 ASR 0.6B
- **THEN** the system SHALL download, verify, and register the model using the existing HF model manager without a separate ASR installer

#### Scenario: Installed Nemotron appears in STT picker
- **WHEN** Nemotron installation completes successfully
- **THEN** local speech-to-text SHALL offer Nemotron without requiring application restart

### Requirement: ASR capability metadata in model registry
Local model registry entries for ASR models SHALL include capability type `asr`, size, runtime, languages, streaming support, and license information.

#### Scenario: Model card displays ASR metadata
- **WHEN** the user views Nemotron in Local Models
- **THEN** the card SHALL show Speech-to-Text capability, multilingual support, and approximate download size (~742 MB)

### Requirement: Local transcription provider auto-detection
`LocalTranscriptionProvider` SHALL automatically detect installed compatible ASR models from the model registry and expose them via `listModels()`.

#### Scenario: Nemotron installed alongside Whisper
- **WHEN** both Nemotron and a legacy Whisper model are installed
- **THEN** `listModels()` SHALL return both with accurate `installed` state and capabilities

### Requirement: Native local Nemotron runtime
Local Nemotron transcription SHALL execute through a native Rust runtime embedded in Plethora (Tauri → Rust ASR layer → Nemotron artifact) without requiring Python, PyTorch, Conda, or external transcription servers.

#### Scenario: Desktop offline transcription
- **WHEN** the user transcribes audio with Local provider and Nemotron installed on desktop
- **THEN** transcription SHALL complete entirely on-device using the native runtime

### Requirement: Compute backend auto-selection
The local Nemotron runtime SHALL automatically select the best available compute backend per platform (Windows/Linux: CUDA > Vulkan > CPU; macOS: Metal > CPU) without requiring ordinary user configuration.

#### Scenario: Apple Silicon Mac transcription
- **WHEN** local Nemotron runs on macOS with Metal available
- **THEN** the runtime SHALL prefer Metal acceleration over CPU-only execution

### Requirement: Chunked long-form local processing
Local transcription of long audio SHALL use progressive decode and chunked processing without loading entire files into memory.

#### Scenario: Multi-hour audiobook local transcription
- **WHEN** the user transcribes a multi-hour file locally
- **THEN** the system SHALL process audio in chunks with bounded memory usage

### Requirement: Secure model download and integrity
ASR model installation SHALL validate checksums/signatures where available, reject corrupted artifacts, support resume, and avoid marking incomplete downloads as installed.

#### Scenario: Interrupted Nemotron download
- **WHEN** a download is interrupted and resumed
- **THEN** the system SHALL resume from partial progress and only mark installed after integrity verification passes

### Requirement: Model licensing display
ASR model metadata SHALL include license information viewable from the Local Models UI, and Plethora SHALL retain required redistribution notices.

#### Scenario: User views Nemotron license
- **WHEN** the user taps License on the Nemotron model card
- **THEN** applicable license information SHALL be displayed
