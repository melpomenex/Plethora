## ADDED Requirements

### Requirement: Centralized Compute Backend Selection
The system SHALL provide a centralized compute backend selector that evaluates available hardware accelerators, runtime execution providers, model compatibility, and user configuration to determine the optimal execution backend for local speech-to-text inference.

#### Scenario: GPU selected on capable hardware under AUTO policy
- **WHEN** local transcription is initiated on a machine with a compatible, usable GPU accelerator
- **AND** the selected model supports that accelerator
- **AND** `computeMode` is set to "AUTO" or "GPU_PREFERRED"
- **THEN** the selector SHALL return the accelerator backend (e.g., CUDA, CoreML) as the primary execution target
- **AND** designate CPU as the fallback target

#### Scenario: CPU-only user override honored
- **WHEN** local transcription is initiated on a machine with a compatible GPU accelerator
- **AND** `computeMode` is set to "CPU_ONLY"
- **THEN** the selector SHALL select the CPU backend
- **AND** SHALL NOT attempt GPU initialization

#### Scenario: Unsupported hardware defaults cleanly to CPU
- **WHEN** local transcription is initiated on a machine with no compatible GPU or missing accelerator drivers
- **AND** `computeMode` is set to "AUTO"
- **THEN** the selector SHALL select the CPU backend without error or modal interruption

### Requirement: Persistent Accelerator Inference Session
The system SHALL maintain a persistent inference session for long-form transcription, loading the model into accelerator memory once per transcription job and streaming audio chunks through the active session.

#### Scenario: Single initialization across multiple audio chunks
- **WHEN** transcribing an audio file spanning multiple chunks
- **AND** an accelerated compute backend is active
- **THEN** the runtime SHALL load model weights and initialize accelerator memory once before chunk processing begins
- **AND** SHALL NOT respawn the sidecar process or recreate the ONNX session between individual chunks

#### Scenario: Idle session eviction
- **WHEN** an accelerated transcription session remains idle with no incoming audio chunks for a configured timeout period
- **THEN** the system SHALL unload the model and terminate the accelerator session to release VRAM

### Requirement: Resilient Checkpointed Fallback to CPU
The system SHALL handle accelerator initialization or execution failures by persisting completed transcript checkpoints and automatically resuming execution on the CPU backend.

#### Scenario: Mid-job accelerator failure failover
- **WHEN** an accelerator failure (such as out-of-memory or device loss) occurs during chunk $N$ of a transcription job
- **THEN** the system SHALL persist all transcript segments completed up to chunk $N-1$
- **AND** terminate the failing accelerator runtime
- **AND** initialize the CPU runtime and resume transcription from chunk $N$
- **AND** complete the job without creating duplicate segments or throwing a fatal error

#### Scenario: Pre-execution initialization failure
- **WHEN** accelerator session initialization fails prior to processing audio
- **THEN** the system SHALL immediately fall back to the CPU backend
- **AND** mark the failing backend as degraded in the runtime health cache

### Requirement: Local-Only Privacy Invariant on Compute Failure
The system SHALL guarantee that hardware acceleration failures never cause audio or transcript data to be transmitted to cloud services when local transcription is requested.

#### Scenario: Accelerator failure does not trigger cloud routing
- **WHEN** a local transcription job encounters an unrecoverable GPU failure
- **AND** `preferLocal` or offline mode is active
- **THEN** the job SHALL fall back solely to the local CPU backend
- **AND** SHALL NOT invoke any external cloud STT API (such as Groq or OpenRouter) unless the user has explicitly authorized cloud fallback for that job

### Requirement: Compute Diagnostics and Hardware Suitability
The system SHALL expose diagnostic telemetry and suitability ratings per compute backend, reporting verified runtime capabilities rather than unverified hardware presence.

#### Scenario: Diagnostics report ground-truth capabilities
- **WHEN** the diagnostic command `transcription_compute_diagnostics` is invoked
- **THEN** it SHALL return the list of detected physical devices, usable runtime providers, model compatibility mappings, and active compute mode
- **AND** report "available" for a provider only if its runtime libraries can actually be loaded

#### Scenario: Backend suitability classification
- **WHEN** evaluating system capabilities for a local STT model
- **THEN** the suitability service SHALL rate performance independently for CPU and available GPU backends using classes: "excellent", "good", "usable", "slow", or "unsupported"
