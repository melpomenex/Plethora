## Context

The desktop exposes automatic, GPU-preferred, and CPU-only modes. The first implementation added a Windows DirectML sidecar for Nemotron, while offline Sherpa models still run through the CPU sidecar and Whisper uses a CPU-only Windows build. Needle uses a separate Cactus `.cact` engine without a Windows GPU inference provider.

## Goals / Non-Goals

**Goals:**
- Deliver end-to-end Windows GPU paths for shipped Sherpa ONNX ASR models and whisper.cpp models.
- Make the selected provider, actual runtime, and UI status agree.
- Preserve local CPU execution and complete-job fallback for unsupported models, drivers, and runtime failures.

**Non-Goals:**
- Add GPU acceleration to Android, browser, or macOS runtimes.
- Add a GPU inference engine for Cactus Needle's `.cact` format.
- Add Granite or another model format/runtime.

## Decisions

### Use DirectML for Sherpa ONNX and Vulkan for whisper.cpp

Build the pinned sherpa-onnx revision with DirectML enabled for both online and offline executables. Package both executables and their dependent DLLs under the isolated `bin/sherpa-directml/` resource directory. Parakeet, SenseVoice, Zipformer, Paraformer, and Nemotron use this runtime when their own model session confirms DirectML. The current CPU sidecars and their ONNX Runtime DLLs remain in their existing locations as the independent fallback.

Build the pinned whisper.cpp sidecar with Vulkan enabled on Windows. Vulkan is the cross-vendor provider for Whisper models and uses the installed GPU driver. A bundled manifest records whether the Whisper sidecar was built with Vulkan. CPU mode passes `--no-gpu`. If Vulkan is missing, fails to initialize, or fails during inference, rerun the entire Whisper job in CPU mode before publishing segments.

### Make selection model- and engine-aware

Use a compatibility table for each Windows inference engine. Enable DirectML for Sherpa ONNX ASR model families and Vulkan for whisper.cpp. A provider is confirmed from the actual model-session output; failed or silent CPU-fallback sessions are discarded and retried from the start on CPU. Offline Sherpa and Whisper outputs remain buffered until the whole job succeeds, preventing duplicate transcript segments after retry. Needle remains CPU-only because the bundled Cactus runtime does not expose a Windows GPU inference path.

### Keep provider reporting tied to runtime evidence

Use DXGI adapter discovery for Windows device information. Report DirectML as available only when both isolated Sherpa executables and their required runtime files are complete. Report Vulkan as available only when the Whisper manifest confirms a Vulkan build, the Vulkan loader is present, and a hardware adapter is detected. Cache model-specific failures so an unsupported operator in one model does not disable acceleration for unrelated models.

### Preserve local fallback semantics

Buffer offline Sherpa chunk results until the entire GPU job succeeds. Nemotron and Whisper also publish output only after process success. Any failed GPU attempt is discarded before retrying the complete audio locally on CPU. GPU failures never enter cloud routing.

### Update the settings model

Keep the existing compute mode selector, but show GPU availability against the selected model/runtime compatibility entry. Distinguish detected hardware, packaged provider, model compatibility, and current-job backend. Localized Windows copy describes DirectML for Sherpa, Vulkan for Whisper, and CPU execution for Needle.

## Risks / Trade-offs

- **DirectML operator coverage varies by model.** Attempt the provider per model session, cache model-specific failures, and retry locally on CPU.
- **Vulkan driver/device behavior varies across vendors.** Confirm actual Whisper backend initialization and retry the whole job on CPU when it fails.
- **GPU sidecars increase build time and package size.** Keep CPU sidecars isolated and measure Windows release artifacts.
- **A retry after partial output can duplicate segments.** Buffer GPU output until the complete job succeeds.

## Migration Plan

1. Produce isolated Windows DirectML online/offline Sherpa runtimes and a Vulkan-enabled Whisper sidecar while preserving CPU execution.
2. Add adapter/provider capability probing and engine-aware model selection.
3. Route Sherpa ASR models to DirectML and Whisper models to Vulkan; keep Needle on CPU.
4. Validate settings, model sessions, and fallback behavior on Windows.
5. Roll back by disabling GPU provider manifests and selecting CPU execution; CPU-only configurations remain usable.
