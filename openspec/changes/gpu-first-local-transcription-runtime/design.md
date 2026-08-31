## Context

Plethora supports several local speech-to-text models and runtimes, including:
- NVIDIA Nemotron 3.5 ASR streaming 0.6B (via the `sherpa-online` transducer sidecar)
- Sherpa-onnx offline models (SenseVoice int8, Parakeet TDT/CTC, Zipformer, Paraformer)
- Whisper.cpp (via the `whisper` sidecar)

Currently, the local transcription path defaults to CPU execution across all sherpa models using 4 threads (`--num-threads=4`), while Whisper has platform-specific GPU builds (e.g. Metal on Apple Silicon, CUDA/Vulkan on Linux) whose availability is reported misleadingly (inferring GPU capability from the presence of `libggml-vulkan.so`).

Most critically, `TranscriptionEngine` processes long audio files by slicing the WAV into 30-second windows and spawning a new sidecar process (`sherpa-online`) for *every single 30-second chunk*. On CPU, this adds slight overhead, but on GPU, initializing CUDA, allocating VRAM, and loading an ONNX session every 30 seconds introduces severe latency and thrashing that completely offsets GPU speedups.

This design introduces:
1. A centralized `ComputeBackendSelector` in the Rust core and frontend `DeviceCapabilityService`.
2. A persistent runtime session architecture for long-form STT (load once, stream chunks via IPC, unload on completion or idle).
3. Resilient fallback that cascades from preferred hardware accelerator (CUDA/CoreML/DirectML/MIGraphX) to CPU mid-transcription without losing job progress or violating local-only privacy boundaries.
4. Ground-truth execution telemetry reporting actual backends in the UI.

## Goals / Non-Goals

**Goals:**
- Provide a centralized backend selector resolving `HardwareCapabilities` + `RuntimeCapabilities` + `ModelCapabilities` + `UserPolicy` → `SelectedExecutionBackend`.
- Expose `TranscriptionComputeMode` (`AUTO` [default], `GPU_PREFERRED`, `CPU_ONLY`) and multi-GPU device selection in Settings.
- Implement persistent process/session lifecycle for `sherpa-online` to load the model and initialize the accelerator once per transcription job.
- Implement CUDA acceleration for Nemotron on Linux and Windows via `--provider=cuda --device=<id>`.
- Provide runtime probing (verifying actual provider loading, not just `nvidia-smi` presence) with typed failure classification.
- Support clean mid-job fallback: if the GPU runs out of memory or crashes on chunk $N$, persist chunk $N-1$ checkpoints and resume chunk $N$ on CPU.
- Standardize Whisper compute reporting on the same telemetry schema, eliminating false Vulkan heuristics.
- Bundle a local STT benchmark harness measuring real-time factor (RTF), latency, and memory utilization.

**Non-Goals:**
- Rewriting or fine-tuning Nemotron or Whisper models.
- Requiring Python, Conda, or developer toolchains on user systems.
- Cloud fallback on GPU failure (local compute failures remain local on CPU unless cloud provider routing was explicitly authorized).
- Mobile GPU acceleration in phase 1 (mobile follows dedicated OS scheduling and thermal constraints).
- Supporting deprecated ONNX Runtime providers such as ROCm EP (directing AMD to MIGraphX on Linux and DirectML on Windows).

## Decisions

### 1. Centralized Backend Selection Architecture
**Decision**: Implement a decoupled compute selector in `src-tauri/src/transcription/compute_backend.rs` rather than embedding GPU flags inside individual engine runners.
- *Rationale*: Different engines (sherpa-onnx, whisper.cpp) and models (Nemotron, SenseVoice, Whisper-large-v3) have distinct provider capabilities. Separating provider resolution (`Local` vs `Cloud`) from compute backend execution (`Cuda` vs `CoreMl` vs `Cpu`) guarantees consistency and simplifies testing.
- *Alternatives considered*:
  - *Engine-specific CLI flags*: Ad-hoc `--gpu` flags in `engine.rs`. Rejected because it leads to inconsistent failure handling and misleading telemetry.

```text
LocalTranscriptionProvider (Service Layer)
          │
          ▼
   TranscriptionEngine
          │
          ▼
ComputeBackendSelector
   ├── HardwareCapabilities (Platform, PCI Devices, VRAM, Driver)
   ├── RuntimeCapabilities  (Sidecar builds, ORT Execution Providers)
   ├── ModelCapabilities    (Precision, supported backends)
   └── BackendHealthCache   (Cached probes, previous failure history)
          │
          ▼
SelectedExecutionBackend (e.g. Cuda(device: 0) -> Fallback: Cpu)
          │
          ▼
PersistentSessionManager / Sidecar Execution
```

### 2. Persistent Nemotron Session vs. Process-Per-Chunk
**Decision**: Introduce a persistent sidecar runner or interactive session for long audio files, where the sidecar process is spawned once with the selected provider, remains loaded across audio chunk segments, and processes streams sequentially before exiting.
- *Rationale*: A 0.6B ONNX transducer takes 1.5–3.0 seconds to initialize CUDA/ORT sessions. Repeated every 30 seconds on a 2-hour audiobook (240 chunks), initialization alone wastes 6–12 minutes and causes GPU memory fragmentation.
- *Alternatives considered*:
  - *Keep process-per-chunk with GPU*: Rejected as a critical performance trap that neutralizes GPU acceleration.
  - *Direct C API via Rust FFI*: Cleanest in-process model, but increases binary linking complexity and risks crashing the entire desktop app if CUDA encounters an unrecoverable SIGSEGV/driver crash. The persistent sidecar process maintains crash isolation while achieving near-identical throughput.

### 3. Progressive Sidecar Packaging and On-Demand Provider Resolution
**Decision**: Structure sidecar packaging with tiered provider distribution:
- Base build packages CPU-capable sidecars and lightweight probing logic.
- Linux/Windows distributions include CUDA-enabled ONNX Runtime libraries or dynamic provider loading where compatible NVIDIA drivers exist.
- If runtime components are missing or fail dynamic link probing, the selector records `GPU_RUNTIME_MISSING` and cleanly selects CPU without throwing fatal errors.
- *Alternatives considered*:
  - *Monolithic bundle of all ORT providers*: Increases installer size by 800MB+ for users without NVIDIA hardware.
  - *On-demand download*: Recommended for heavy vendor-specific acceleration packs in subsequent distribution updates; initial release leverages dynamic sidecar discovery.

### 4. Typed Error Taxonomy and Checkpoint-Preserving Failover
**Decision**: Introduce structured Rust error types:
```rust
pub enum ComputeError {
    BackendUnavailable(String),
    DriverUnavailable(String),
    RuntimeMissing(String),
    InitializationFailed(String),
    OutOfMemory { required_bytes: Option<u64>, free_bytes: Option<u64> },
    ExecutionFailed(String),
    DeviceLost(String),
    UnsupportedOperator(String),
    ModelCorrupt(String),
}
```
If a job encounters an accelerator failure (e.g. `OutOfMemory` or `DeviceLost`) during chunk $N$:
1. Checkpoint for chunk $N-1$ is committed to the database.
2. The failing GPU session is torn down and its resources freed.
3. The health cache marks that device/backend as degraded for the current session.
4. An event `transcription-backend-fallback` is emitted to notify the UI without disrupting the user.
5. A fallback CPU session is spawned to process chunk $N$ and all remaining chunks.
- *Rationale*: Audiobooks and lectures can take hours. A transient VRAM spike or GPU sleep event must never invalidate completed work or fail the entire job.

### 5. Truthful Telemetry and Diagnostics
**Decision**: Provide `transcription_compute_diagnostics` IPC command returning:
- Detected hardware (GPUs, VRAM, vendor, driver)
- Probed runtime providers (CUDA, CoreML, DirectML, CPU)
- Model compatibility map
- Active compute mode setting (`AUTO`, `GPU_PREFERRED`, `CPU_ONLY`)
- Active backend per running job
Whisper detection will inspect verified runtime startup banners (e.g., CUDA/Metal initialization logs) rather than checking for `libggml-vulkan.so`.

## Risks / Trade-offs

- **[Risk] High VRAM usage causing Out-Of-Memory (OOM) on entry-level GPUs (e.g. 4GB–6GB cards)**
  → *Mitigation*: Pre-flight VRAM query before choosing CUDA; fallback immediately to CPU if free VRAM is under 1.5GB or if ORT emits OOM.
- **[Risk] CUDA / dynamic library mismatch across diverse Linux distros**
  → *Mitigation*: Sidecar pre-flight probe test-loads the provider with a 0.5-second synthetic pulse; if dynamic linking fails, cache `RuntimeMissing` and immediately use CPU.
- **[Risk] Stale persistent sidecar processes or zombie sidecars on crash**
  → *Mitigation*: Bind sidecar lifecycle to a Tokio task handle, track child PID, and attach an idle timeout (e.g., 60 seconds) that automatically shuts down the session when no audio arrives.
- **[Risk] Incomplete ONNX Runtime operator support on non-NVIDIA GPUs (DirectML/MIGraphX) resulting in CPU fallback thrashing inside ORT**
  → *Mitigation*: Gate DirectML and MIGraphX behind strict validation flags; keep CPU as preferred until performance benchmarks verify >1.5× speedup over CPU on that target.

## Migration Plan

1. **Step 1**: Implement `ComputeBackendSelector` and `TranscriptionComputeMode` with CPU default parity (no regressions to current Whisper/Nemotron jobs).
2. **Step 2**: Implement persistent `sherpa-online` streaming protocol and verify against existing unit tests and chunked audio.
3. **Step 3**: Enable `--provider=cuda` on NVIDIA Linux/Windows with automatic CPU failover.
4. **Step 4**: Migrate Whisper runtime status reporting from Vulkan heuristics to ground-truth execution logs.
5. **Step 5**: Expose Compute settings and active backend badges in the Plethora frontend.
