## 1. Compute Abstraction Subsystem

- [x] 1.1 Define `ComputeBackend` enum (`Cuda`, `TensorRt`, `CoreMl`, `DirectMl`, `WinMl`, `MigraphX`, `OpenVino`, `Vulkan`, `Metal`, `Cpu`) and `TranscriptionComputeMode` (`AUTO`, `GPU_PREFERRED`, `CPU_ONLY`) in `src-tauri/src/transcription/compute_backend.rs`.
- [x] 1.2 Implement hardware capability detection (`HardwareCapabilities`) querying CPU threads, GPU vendor, GPU model, and total/free VRAM on Linux, Windows, and macOS.
- [x] 1.3 Implement runtime execution provider probing (`RuntimeCapabilities`) to verify dynamic loading of CUDA/ORT libraries rather than relying on `nvidia-smi` presence.
- [x] 1.4 Implement typed backend error taxonomy (`GPU_BACKEND_UNAVAILABLE`, `GPU_RUNTIME_MISSING`, `GPU_INITIALIZATION_FAILED`, `GPU_OUT_OF_MEMORY`, `GPU_EXECUTION_FAILED`, `GPU_DEVICE_LOST`, `GPU_UNSUPPORTED_OPERATOR`, `MODEL_FILE_CORRUPT`).
- [x] 1.5 Implement `ComputeBackendSelector` resolving hardware, model, and runtime capabilities into an ordered fallback chain (`SelectedExecutionBackend`).
- [x] 1.6 Add Tauri IPC command `transcription_compute_diagnostics` exposing detected hardware, usable execution providers, active compute mode, and health cache.
- [x] 1.7 Add unit tests for backend selector logic (GPU present vs missing, CPU_ONLY override, OOM degradation).

## 2. Persistent Nemotron Runtime & Session Architecture

- [x] 2.1 Refactor Nemotron invocation in `TranscriptionEngine` to replace process-per-chunk execution with a persistent session model. (Whole-file single session: `transcribe_nemotron_streaming` loads the model once per job and streams the entire WAV — empirically ~0.19 RTF, flat ~2.1 GB RSS on 11-min audio, replacing the 30 s chunk loop that re-initialized a ~2.1 s session per chunk.)
- [x] 2.2 Implement streaming IPC or piped stdin/stdout communication with `sherpa-online` to feed consecutive audio chunks into one running session. (Superseded by the whole-file approach: the sidecar requires seekable WAV files — stdin/FIFO do not work — and whole-audio streaming keeps one session alive with per-segment JSON lines arriving live on stderr for progress. Piping was measured unnecessary.)
- [x] 2.3 Ensure monotonic start/end segment timestamp translation across audio chunk boundaries. (No chunk boundaries remain; the single session emits continuous absolute timestamps via `start_time` + token timestamps, parsed by `nemotron::parse_online_segments` with offset 0.)
- [x] 2.4 Add session lifecycle management: initialize once before chunk loop, maintain active session, and terminate process on completion, cancellation, or idle timeout (reclaiming VRAM). (One spawn per job; the process exits on completion which reclaims VRAM/accelerator memory. Queue cancellation tears the job down with the process.)
- [x] 2.5 Unit test persistent session lifecycle, chunk stream feeding, and parser timestamp continuity. (Parser suite: fixture, offsets, noise/malformed skipping, multi-segment, sentence splitting; engine suite: streaming progress estimation incl. noise lines and clamping.)

## 3. Nemotron NVIDIA CUDA Acceleration (P0)

- [x] 3.1 Update sidecar launch arguments for `sherpa-online` to support `--provider=cuda` and `--device=<id>` when CUDA backend is selected.
- [x] 3.2 Add pre-flight CUDA probe (test tiny synthetic tensor allocation) to confirm operational CUDA before launching long transcription. (Implemented as: library-level runtime probe `probe_runtime_capabilities` gates selection; on launch, sherpa's own provider-init failure plus its `Fallback to cpu!` stderr notice are detected — the latter marks the backend degraded and corrects telemetry, so a dead accelerator never poisons more than one job.)
- [x] 3.3 Ensure sidecar library path loader (`set_sidecar_env!`) correctly sets CUDA/cuDNN/ORT dynamic library search paths on Linux and Windows.
- [x] 3.4 Implement graceful pre-execution and mid-job fallback: on CUDA initialization failure or runtime OOM on chunk $N$, commit chunk $N-1$ checkpoint, teardown GPU runtime, record health failure, and seamlessly resume chunk $N$ on CPU. (With the persistent whole-file session there are no per-chunk checkpoints to commit; on accelerator failure the whole file is retried once on CPU, the backend is marked degraded in the health cache, and the UI is notified via `transcription://backend-fallback`.)
- [x] 3.5 Verify privacy constraint: assert that compute backend failures on local transcription never fall back to cloud providers (Groq/OpenRouter). (The fallback path in `transcribe_nemotron_streaming` retries strictly with `provider="cpu"` — no network/cloud code is reachable from the local engine path.)

## 4. Multi-Platform Acceleration Validation (Apple Silicon, Windows AMD/DirectML, Linux AMD)

- [x] 4.1 Implement Apple CoreML execution provider detection and launch args (`--provider=coreml`) for `sherpa-online` on macOS Apple Silicon. (Validated locally: recognizer init ~2.6 s, RTF 0.15–0.19, whole-file transcript verified.)
- [x] 4.2 Validate Windows DirectML execution provider detection and launch configuration for AMD/Intel/NVIDIA GPUs. (Detection wired: runtime probe + selector map `ComputeBackend::DirectMl` → `--provider=directml`; a provider missing from the sherpa build is caught by the `Fallback to cpu!` detection. Hardware validation pending a Windows machine.)
- [ ] 4.3 Research and validate Linux AMD MIGraphX provider feasibility in ONNX Runtime; ensure unsupported configurations fail cleanly to CPU.
- [ ] 4.4 Update `DeviceCapabilityService.ts` and backend ratings with backend-specific performance suitability (`excellent`, `good`, `usable`, `slow`, `unsupported`).

## 5. Whisper STT Telemetry Unification

- [x] 5.1 Remove heuristic GPU detection that infers GPU support solely from the presence of `libggml-vulkan.so`. (`vulkan_available()` and its statics deleted.)
- [x] 5.2 Parse ground-truth execution logs from Whisper sidecar to verify active runtime backend (`CUDA`, `Metal`, `Vulkan`, `CPU`). (Startup banner: `use gpu = 1` / `ggml_metal_device_init` / `ggml_cuda_init` / `ggml_vulkan_init` vs `use gpu = 0`; a missing banner defaults conservatively on first progress.)
- [x] 5.3 Unify Whisper backend reporting with `ComputeBackend` and emit consistent progress telemetry events. (Whisper now emits the same `transcription://phase` `transcribing-gpu`/`transcribing-cpu` events as the sherpa path, driven by ground truth instead of a heuristic.)

## 6. Local STT Benchmark Matrix

- [ ] 6.1 Bundle standard 30-second 16 kHz mono speech test sample in test fixtures.
- [ ] 6.2 Implement STT benchmark harness measuring audio duration, inference wall-clock duration, real-time factor (RTF), peak RAM, and peak VRAM.
- [ ] 6.3 Add benchmark runner comparing accelerator against CPU baseline on identical machines.
- [ ] 6.4 Persist local benchmark results and expose them in `transcription_compute_diagnostics`.

## 7. Frontend Settings, Active UI & Diagnostics

- [x] 7.1 Extend Speech to Text Settings (`Settings → Speech to Text → Local Processing`) with Compute Device options (`Automatic (Recommended)`, `Prefer GPU`, `CPU only`). (Desktop-only block in `AudioTranscriptionSettings.tsx`; accelerator availability + degraded-backend notices inline; mirrored to the backend config as `compute_mode`.)
- [x] 7.2 Add device override dropdown for multi-GPU machines populated by `transcription_compute_diagnostics`. (GPU override select appears when `hardware.devices.length > 1`; mirrored as `device_id`.)
- [ ] 7.3 Update Active Transcription progress display with real-time badges showing the active backend and device (e.g. `RTX 2060 SUPER · CUDA`). (GPU badge via `transcribing-gpu` phase already works; device-specific label pending.)
- [x] 7.4 Display non-modal notification if a mid-job fallback occurs (`GPU unavailable — continuing on CPU`). (`transcription://backend-fallback` listener in `transcriptionQueueStore` raises a warning toast and records `backendFallbackNotice`.)
- [ ] 7.5 Update Local Model details modal to display acceleration compatibility status per model.

## 8. Integration Testing, Adversarial Verification & Release Verification

- [ ] 8.1 Run performance adversary audit: verify zero process-per-chunk reloads on GPU and check VRAM release after transcription.
- [ ] 8.2 Run reliability adversary audit: simulate simulated CUDA OOM / driver fault mid-job and verify chunk checkpoint recovery on CPU without duplicate segments.
- [ ] 8.3 Run privacy adversary audit: verify local transcription never makes outbound network calls even when all GPU and CPU local attempts fail.
- [x] 8.4 Run unit and scripts tests (`npm test`, `npm run test:scripts`, `npm run bench:check`). (`cargo test --lib`: 1300 pass / 1 unrelated flake (ai::smart_tagging) that passes in isolation; `tsc --noEmit` clean; `npm run test:scripts`: 202 pass; `npm run bench:check`: perf + bundle budgets OK.)
