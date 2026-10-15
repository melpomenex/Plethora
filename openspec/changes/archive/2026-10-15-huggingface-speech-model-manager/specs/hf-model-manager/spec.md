## ADDED Requirements

### Requirement: Hugging Face model input and metadata discovery
The system SHALL accept a Hugging Face repository URL or `owner/model` id (optionally with `#revision`/branch) and SHALL inspect the repository to discover metadata: model name, task, architecture tags, parameter count when exposed, precision/quantization, approximate download size (from file listing / LFS metadata), license when available, and the actual artifact files present. The inspection SHALL be asynchronous and SHALL NOT block the UI.

#### Scenario: Repo metadata displayed
- **WHEN** the user enters a valid HF repo id and inspection completes
- **THEN** the UI SHALL show the discovered metadata (name, task, architecture, params, precision, size, license, files) with estimates clearly labeled as estimates

#### Scenario: Invalid repo id
- **WHEN** the user enters a non-existent repo id
- **THEN** the system SHALL show a clear "repository not found" state and SHALL NOT attempt a download

### Requirement: Runtime-compatibility determination
The system SHALL determine whether a repo plausibly contains a model compatible with one of Plethora's supported speech runtimes, based on a per-runtime adapter. Supported at minimum: ggml `.bin` for whisper.cpp STT; ONNX (`model.onnx`/`model.int8.onnx` + `tokens.txt`/`tokens.json`) for sherpa-onnx STT and sherpa TTS. The adapter architecture SHALL allow new runtimes to be added without rewriting the manager. A repo tagged "TTS/STT" that matches no supported architecture/artifact SHALL be reported as `unsupported_runtime` and SHALL NOT be claimed as installable.

#### Scenario: Compatible repo identified
- **WHEN** a repo contains a supported artifact (e.g. a `ggml-*.bin` for whisper.cpp, or an ONNX + tokens file for sherpa)
- **THEN** the system SHALL mark the model as compatible with the matching runtime and adapter

#### Scenario: Unsupported repo rejected
- **WHEN** a repo is tagged TTS/STT but contains no artifact matching any installed Plethora speech runtime (e.g. only PyTorch `.bin` checkpoints or safetensors with no adapter)
- **THEN** the system SHALL classify it `unsupported_runtime` with an explanation, and installation SHALL be blocked or gated behind an explicit advanced override

### Requirement: Hardware detection
The system SHALL detect the user's machine capabilities needed for suitability: OS, CPU architecture and core count, system RAM and (where useful) available RAM, GPU type and VRAM, CUDA availability, Metal/Apple Silicon (unified memory), supported accelerators, and available disk space. Detection SHALL run in the Rust backend and SHALL be available to the suitability logic and UI.

#### Scenario: NVIDIA GPU detected
- **WHEN** the machine has an NVIDIA GPU with VRAM reported (and CUDA availability probed)
- **THEN** the detected VRAM and CUDA availability SHALL be used by the suitability check

#### Scenario: Apple Silicon detected
- **WHEN** the machine is Apple Silicon
- **THEN** the suitability check SHALL use unified-memory/runtime reasoning (not CUDA rules)

#### Scenario: CPU-only machine
- **WHEN** the machine has no detectable GPU accelerator
- **THEN** suitability SHALL be evaluated for CPU inference and SHALL warn realistically about large models

### Requirement: Suitability classification with explanation
The system SHALL classify a candidate model using a useful scale (names matching Plethora's UX), e.g. `Recommended` / `Should Run` / `May Run Slowly (Requires Offload)` / `Not Recommended` / `Unsupported Runtime`, each with a human explanation (e.g. "Requires ~12 GB VRAM; detected GPU has 8 GB", "Compatible with CPU inference but expected to be slow", "Model requires CUDA; CUDA runtime unavailable", "Estimated model files exceed available disk space"). When the chosen artifact/quantization differs from the full-precision upstream repo, the check SHALL evaluate the actual artifact.

#### Scenario: Insufficient VRAM
- **WHEN** a model realistically requires ~12 GB VRAM and the detected GPU has 8 GB and no valid CPU/offload config exists
- **THEN** the system SHALL classify it `not_recommended` (or warn/block) with the VRAM explanation

#### Scenario: Disk space check
- **WHEN** the estimated download size exceeds available disk space
- **THEN** the system SHALL classify/block with a disk-space explanation

#### Scenario: Quantization considered
- **WHEN** a repo offers a quantized artifact (e.g. `int8`/`fp16` ONNX) alongside the full-precision artifact
- **THEN** the suitability check SHALL evaluate the artifact the user will actually install

### Requirement: Safe installation lifecycle
The system SHALL install a model with: streaming download with progress events, cancellation, partial-download cleanup, retries, integrity verification (SHA-256 when the repo/artifact provides it), a defined storage location under the existing model directories, model removal, re-detection after restart, duplicate-install prevention, and version/revision identification. The UI SHALL remain responsive during inspection and download.

#### Scenario: Download with progress and cancel
- **WHEN** a download is in progress
- **THEN** the UI SHALL show live progress and a cancel control; canceling SHALL clean up partial files and mark the model not-installed

#### Scenario: Failed download
- **WHEN** a download fails mid-stream
- **THEN** the system SHALL surface a clear error, clean up partial files, and offer retry; the model SHALL NOT be marked installed

#### Scenario: Integrity verification
- **WHEN** the artifact provides a known SHA-256
- **THEN** the download SHALL be verified and SHALL fail closed (not register) on mismatch

#### Scenario: Duplicate install
- **WHEN** the user attempts to install an already-installed model (same repo id + revision)
- **THEN** the system SHALL report it as already installed and SHALL NOT download a duplicate

#### Scenario: Restart re-detection
- **WHEN** Plethora restarts after a model was installed
- **THEN** the model SHALL appear as installed in the appropriate TTS/STT model picker without a fresh download

### Requirement: Installed model is registered and selectable
After installation the model SHALL be registered with Plethora and SHALL become available in the appropriate TTS or STT model picker (e.g. `AudioTranscriptionSettings` default-model select for STT; the relevant TTS voice/model surface for TTS).

#### Scenario: STT model selectable
- **WHEN** an STT model is installed
- **THEN** it SHALL appear in the STT model picker and SHALL be usable for local transcription

#### Scenario: TTS model selectable
- **WHEN** a TTS model is installed through a supported TTS runtime
- **THEN** it SHALL appear in the relevant TTS model/voice surface and SHALL be usable for synthesis

### Requirement: Security model
The system SHALL treat downloaded repositories/models as untrusted data. It SHALL NOT execute arbitrary repository code, SHALL NOT silently enable `trust_remote_code`-style behavior, SHALL only spawn sidecars through the existing `tauri-plugin-shell` `.sidecar()` mechanism with the established `env_clear()`/whitelisted-env pattern, and SHALL verify integrity. If a runtime genuinely requires executable custom code, the user SHALL be explicitly informed and consent explicitly — it SHALL NOT be silently enabled. The security model SHALL be documented in the implementation.

#### Scenario: No silent custom code execution
- **WHEN** a repo would require executing untrusted code (e.g. remote code / custom loading) to run
- **THEN** the system SHALL NOT execute it silently; it SHALL require explicit user opt-in or refuse, and SHALL explain why

### Requirement: Licensing surfaced
The system SHALL surface the model license from HF metadata when available and SHALL note that downloading a model does not grant rights to use it.

#### Scenario: License displayed
- **WHEN** the model metadata includes a license
- **THEN** the license SHALL be shown in the model details, with a note that Plethora downloading it does not grant usage rights