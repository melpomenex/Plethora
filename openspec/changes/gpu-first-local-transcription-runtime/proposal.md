## Why

Plethora performs most local speech-to-text inference on the CPU, even on machines equipped with high-performance discrete GPUs or platform neural accelerators. This is especially detrimental for NVIDIA Nemotron 3.5 ASR 0.6B, which Plethora currently executes through the sherpa-onnx streaming runtime restricted to 4 CPU threads and launched in a new process for every 30-second audio chunk.

Users who configure local transcription expect privacy, zero API costs, and responsive performance without needing expertise in CUDA drivers, ONNX Runtime Execution Providers, DirectML, CoreML, or device topologies. Furthermore, current GPU detection in Whisper is brittle (inferring GPU capability solely from the presence of `libggml-vulkan.so`), and hardware initialization failures can abruptly fail jobs.

Plethora requires a unified, GPU-first execution policy: automatically detect available hardware and runtime providers, rank compatible backends, load persistent accelerator sessions (eliminating chunk reload thrashing), and gracefully fall back to CPU mid-job without dropping checkpoints or leaking audio to cloud providers.

## What Changes

- **Centralized Compute Backend Selection Subsystem**: Introduce `ComputeBackendSelector` and `ComputeBackend` abstractions (`Cuda`, `TensorRt`, `CoreMl`, `DirectMl`, `WinMl`, `MigraphX`, `OpenVino`, `Vulkan`, `Metal`, `Cpu`) resolving hardware, model, and runtime capabilities.
- **Configurable Compute Modes**: Expose `TranscriptionComputeMode` (`AUTO` [default], `GPU_PREFERRED`, `CPU_ONLY`) in Settings → Speech to Text → Local Processing, alongside multi-GPU device override options.
- **Persistent Nemotron Session Architecture**: Replace the process-per-chunk model reload pattern in `TranscriptionEngine` with a persistent inference session per job (load once, stream all chunks, unload on completion or idle timeout) to avoid multi-second GPU initialization overhead on every chunk.
- **NVIDIA CUDA Acceleration for Nemotron (P0)**: Support `--provider=cuda` and device targeting in sherpa-online sidecar execution on Linux and Windows, backed by runtime probing rather than passive `nvidia-smi` presence.
- **Multi-Platform Accelerator Roadmap (P1/P2)**: Target Apple CoreML for macOS, WinML/DirectML for Windows AMD/Intel, and MIGraphX/OpenVINO where supported by ONNX Runtime.
- **Resilient Mid-Job Fallback**: Implement typed backend errors (`GPU_OUT_OF_MEMORY`, `GPU_INITIALIZATION_FAILED`, `GPU_DEVICE_LOST`, etc.). In the event of an accelerator fault, persist the current audio chunk checkpoint and resume inference on CPU without restarting the entire transcription or creating duplicate segments.
- **Ground-Truth Runtime Telemetry**: Replace inferred GPU flags (e.g. `libggml-vulkan.so`) with verified runtime execution telemetry across both Nemotron and Whisper, displaying the actual active device and backend in the UI (`NVIDIA RTX 2060 SUPER · CUDA`, `Apple M4 · Metal`).
- **Diagnostic Command & Hardware Suitability**: Add `transcription_compute_diagnostics` IPC command and enhance `DeviceCapabilityService` to rate suitability per compute backend (`Excellent`, `Good`, `Usable`, `Slow`, `Unsupported`).
- **Local STT Benchmark Matrix**: Bundle a standardized 30-second 16 kHz test sample to measure Real-Time Factor (RTF), memory, and VRAM utilization, comparing accelerator versus CPU performance.
- **Strict Privacy Isolation**: Enforce architectural separation between provider routing (local vs cloud) and compute backend selection (GPU vs CPU). Accelerator failures never trigger cloud fallback unless cloud routing is independently permitted.

## Capabilities

### New Capabilities
- `gpu-first-transcription-backend-selection`: Centralized detection, ranking, configuration (`AUTO`, `GPU_PREFERRED`, `CPU_ONLY`), and typed fallback resolution across hardware, runtimes, and models.
- `persistent-nemotron-runtime`: Persistent Nemotron inference session lifecycle (single model load per transcription job, stream chunks, VRAM management, idle unloading, and checkpointed CPU failover).
- `accurate-stt-compute-telemetry`: Ground-truth execution provider reporting across local STT engines (sherpa-onnx, whisper.cpp) and real-time backend/device status in UI and diagnostics.
- `local-stt-benchmark-matrix`: Standardized benchmark harness for local speech-to-text measuring RTF, wall-clock time, and memory/VRAM across available execution backends.

### Modified Capabilities
- `audiobook-podcast-stt-routing`: Decouple transcription provider routing (local vs cloud) from compute backend selection (GPU vs CPU), enforcing that compute-tier failures fall back strictly to local CPU and never violate offline/local privacy guarantees.

## Impact

- **Rust Runtime (`src-tauri/src/transcription/`)**:
  - `engine.rs`: Refactored to coordinate with compute backend selector and utilize persistent sidecar/runtime sessions instead of spawning `sherpa-online` per 30s chunk.
  - `nemotron.rs`: Extended for streaming IPC / session control, status parsing, and checkpoint synchronization.
  - New modules: `compute_backend.rs`, `hardware.rs`, `diagnostics.rs`, `persistent_session.rs`.
- **Sidecar Packaging & Dependencies**:
  - `sherpa-online` and `sherpa-onnx` packaging updated to support CUDA execution provider on Windows/Linux; dynamic dependency resolution for ONNX Runtime providers.
- **Frontend Services & UI (`src/`)**:
  - `DeviceCapabilityService.ts`: Enhanced to query backend diagnostics and rate performance per hardware backend.
  - `TranscriptionService.ts` & STT providers: Updated to pass compute mode and device override options.
  - Settings UI (`Settings → Speech to Text`): New compute device selection (`Automatic`, `Prefer GPU`, `CPU only`), device selector dropdown, and hardware diagnostics viewer.
  - Active Transcription UI: Real-time badges for active execution backend (e.g. `RTX 3080 · CUDA`, `CPU fallback`).
- **APIs & Commands**:
  - New Tauri command `transcription_compute_diagnostics`.
  - Updated transcription job payload and progress events with compute backend metadata.
