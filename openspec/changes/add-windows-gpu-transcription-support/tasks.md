## 1. Windows GPU Runtimes

- [x] 1.1 Extend the pinned sherpa-onnx DirectML build to package both online and offline ASR sidecars.
- [x] 1.2 Keep CPU sidecars and DLLs isolated so GPU runtime failures preserve CPU transcription.
- [x] 1.3 Build and package the Windows whisper.cpp sidecar with Vulkan support and a build manifest.
- [x] 1.4 Update the Windows build/release workflows with the Vulkan build prerequisites.
- [x] 1.5 Validate both runtime manifests and required files before exposing providers.

## 2. Windows Hardware and Provider Diagnostics

- [x] 2.1 Detect Windows adapters through DXGI and expose adapter names, vendors, indexes, and dedicated memory.
- [x] 2.2 Probe DirectML online/offline files and Vulkan Whisper manifest, loader, and hardware separately.
- [x] 2.3 Expose engine/model-specific provider compatibility and degraded status through diagnostics.
- [x] 2.4 Cache model-specific provider failures so an unsupported model does not disable GPU use for other models.
- [ ] 2.5 Validate diagnostics for missing runtime, absent loader, and unsupported adapters on Windows.

## 3. Model-Aware GPU Selection

- [x] 3.1 Define Windows compatibility for all Sherpa ONNX ASR model families, Whisper, and CPU-only Needle.
- [x] 3.2 Route Parakeet, SenseVoice, Zipformer, Paraformer, and Nemotron through the isolated DirectML runtime.
- [x] 3.3 Route Whisper models through the Vulkan-enabled whisper.cpp sidecar and honor CPU-only mode.
- [x] 3.4 Preserve CPU execution for Needle and unsupported model/runtime combinations.
- [x] 3.5 Preserve automatic/GPU-preferred/CPU-only selection and selected-device behavior where the engine supports it.
- [ ] 3.6 Validate model compatibility and compute modes on a Windows x64 build.

## 4. Execution Telemetry and Fallback

- [x] 4.1 Report GPU execution only after Sherpa or Whisper confirms the requested provider.
- [x] 4.2 Buffer all offline Sherpa chunk output and retry the complete job on CPU after any GPU failure.
- [x] 4.3 Retry failed Vulkan Whisper jobs with GPU disabled before emitting segments.
- [x] 4.4 Keep accelerator failure inside the selected local transcription path without changing cloud routing.
- [ ] 4.5 Verify provider status, fallback telemetry, and duplicate-segment behavior on Windows.

## 5. Windows Settings

- [x] 5.1 Show provider readiness and compatibility for the selected Sherpa/Whisper model, with Needle marked CPU-only.
- [x] 5.2 Localize Windows guidance for DirectML Sherpa, Vulkan Whisper, and CPU-only Needle.

## 6. Windows Validation

- [ ] 6.1 Build and run Windows integration checks for DirectML online/offline sessions, Vulkan Whisper, CPU-only mode, and fallback.
- [ ] 6.2 Validate supported AMD, Intel, and NVIDIA adapters and record unsupported combinations.
