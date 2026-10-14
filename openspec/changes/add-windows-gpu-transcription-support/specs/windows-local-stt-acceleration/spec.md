## Purpose

Enable Windows desktop users to accelerate supported local speech transcription with engine-appropriate GPU runtimes while retaining reliable CPU execution and fallback.

## ADDED Requirements

### Requirement: Engine-aware Windows GPU selection
The system SHALL select a Windows GPU backend only when the selected model, inference engine, packaged runtime, and detected adapter support that backend. Automatic and GPU-preferred modes SHALL retain CPU fallback; CPU-only mode SHALL bypass GPU initialization.

#### Scenario: Sherpa ONNX model uses DirectML
- **WHEN** a Parakeet, SenseVoice, Zipformer, Paraformer, or Nemotron ASR model is selected
- **AND** the isolated Windows Sherpa DirectML runtime is available
- **THEN** the system SHALL attempt that model with DirectML
- **AND** SHALL report GPU execution only after that model session confirms DirectML
- **AND** SHALL retry the complete local job on CPU if initialization or inference fails

#### Scenario: Whisper model uses Vulkan
- **WHEN** a local Whisper model is selected
- **AND** the Windows whisper.cpp sidecar was built with Vulkan
- **AND** a Vulkan-capable adapter and loader are available
- **THEN** the system SHALL attempt Whisper with Vulkan
- **AND** SHALL report GPU execution only after whisper.cpp confirms Vulkan initialization
- **AND** SHALL retry the complete local job with GPU disabled if initialization or inference fails

#### Scenario: Needle has no Windows GPU inference provider
- **WHEN** the Cactus Needle model is selected on Windows
- **THEN** the system SHALL run Needle on CPU
- **AND** SHALL report GPU acceleration as unavailable for that model

#### Scenario: Unsupported model or provider
- **WHEN** the selected model or its runtime does not support a usable Windows GPU provider
- **THEN** the system SHALL run the model on CPU
- **AND** SHALL NOT attempt a provider known to be unsupported by that model/runtime combination

#### Scenario: CPU-only mode is selected
- **WHEN** the user selects CPU-only mode for local transcription
- **THEN** the system SHALL run the model on CPU
- **AND** SHALL NOT initialize or provision a GPU runtime for that job

### Requirement: Windows GPU runtime availability
The system SHALL provide the runtime components required by DirectML Sherpa and Vulkan Whisper through the application package or an application-managed installation. GPU runtime setup SHALL NOT require users to install a compiler, SDK, or model development toolchain, and a missing or failed GPU runtime SHALL NOT prevent CPU transcription.

#### Scenario: Required runtime is available
- **WHEN** a supported Windows GPU backend is selected for a compatible model
- **THEN** the system SHALL verify the appropriate sidecar build manifest and runtime components before offering that provider
- **AND** SHALL verify model-session initialization before reporting GPU execution as active

#### Scenario: Runtime setup fails
- **WHEN** a GPU runtime cannot be installed, loaded, or verified
- **THEN** the system SHALL mark that provider unusable for the current runtime state
- **AND** SHALL continue the local transcription on CPU

### Requirement: Verified Windows adapter and provider diagnostics
The system SHALL report Windows GPU adapters and execution providers based on detected hardware and runtime capability checks. A provider SHALL NOT be reported as usable solely because a GPU adapter exists or because the application has a GPU preference setting.

#### Scenario: Runtime diagnostics report packaged providers
- **WHEN** diagnostics are requested on Windows
- **AND** a hardware adapter and complete DirectML or Vulkan runtime are present
- **THEN** diagnostics SHALL report the adapter and packaged provider separately
- **AND** SHALL include model compatibility for each provider

#### Scenario: A model session confirms or rejects a provider
- **WHEN** a compatible model session starts
- **THEN** the system SHALL report the provider confirmed by that model's sidecar
- **AND** SHALL mark only that provider/model combination degraded when the model falls back or fails

#### Scenario: Adapter exists without a usable provider
- **WHEN** Windows reports a GPU adapter but the required provider is absent or fails initialization
- **THEN** diagnostics SHALL report the adapter as detected and the provider as unavailable
- **AND** SHALL distinguish a missing runtime from unsupported hardware or model

### Requirement: Local CPU fallback after GPU failure
The system SHALL keep local transcription available when a Windows GPU provider fails during initialization or execution. It SHALL complete the job on CPU without sending audio or transcript data to a cloud service unless cloud transcription was separately selected by the user.

#### Scenario: Provider fails before transcription begins
- **WHEN** a selected GPU provider fails to initialize before processing audio
- **THEN** the system SHALL mark the provider/model combination degraded
- **AND** SHALL retry the job on CPU
- **AND** SHALL notify the user that transcription is continuing on CPU

#### Scenario: Offline Sherpa fails after GPU chunks completed
- **WHEN** a DirectML Sherpa job fails after one or more chunks have completed
- **THEN** the system SHALL discard all buffered GPU chunk output
- **AND** SHALL rerun the complete audio on CPU before emitting transcript segments
- **AND** SHALL emit each final segment at most once

#### Scenario: Whisper fails after producing intermediate output
- **WHEN** a Vulkan Whisper job fails after producing intermediate output
- **THEN** the system SHALL discard the failed attempt's output
- **AND** SHALL rerun the complete audio on CPU before emitting transcript segments
- **AND** SHALL emit each final segment at most once

### Requirement: Truthful acceleration status in Windows settings
The Windows speech settings SHALL describe GPU acceleration according to verified provider availability and the selected model's compatibility. They SHALL distinguish detected hardware from a provider that can actually accelerate transcription.

#### Scenario: Compatible GPU model is available
- **WHEN** a compatible model and usable Windows GPU provider are available
- **THEN** settings SHALL show packaged GPU acceleration as available for that model
- **AND** SHALL identify the current job backend only after the selected model's sidecar confirms it

#### Scenario: Windows GPU acceleration is unavailable
- **WHEN** no compatible, usable provider is available for the selected model
- **THEN** settings SHALL explain that the model will run on CPU
- **AND** SHALL NOT claim that GPU transcription is active or available merely because a GPU was detected
