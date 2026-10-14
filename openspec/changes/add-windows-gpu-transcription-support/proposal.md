## Why

Plethora exposes a GPU preference for desktop transcription, but Windows local transcription still ships with CPU-only sidecars and does not verify that DirectML or another GPU provider can actually run the selected model. This change makes Windows GPU acceleration a working, model-aware capability and keeps the UI honest when a model or runtime must use CPU.

## What Changes

- Add end-to-end Windows GPU execution paths for the shipped local speech models: DirectML for Sherpa ONNX families and Vulkan for whisper.cpp.
- Detect Windows GPU adapters and probe the installed sidecar/provider combination instead of reporting DirectML as usable unconditionally.
- Package or provision the required Windows GPU runtime without requiring users to install a compiler or SDK.
- Select GPU only when the selected model and its engine-specific runtime support it; keep unsupported runtimes on CPU.
- Preserve local CPU fallback on provider initialization or execution failure, and report the backend that actually ran.
- Replace the static Windows CPU-only guidance with status based on verified runtime and model support.

## Capabilities

### New Capabilities
- `windows-local-stt-acceleration`: Windows adapter and provider discovery, model-aware GPU selection, runtime availability, fallback behavior, and truthful acceleration status for local speech transcription.

### Modified Capabilities

## Impact

- Rust transcription backend selection, Windows hardware detection, sidecar launch and provider probing under `src-tauri/src/transcription/`.
- Windows sidecar/runtime packaging in `scripts/download-sidecars.js` and related build configuration.
- Desktop speech settings and localized GPU status text in `src/components/settings/AudioTranscriptionSettings.tsx` and `src/lib/i18n/locales/`.
- Windows-targeted validation for supported GPU vendors, model/provider combinations, CPU-only mode, and fallback behavior.

The current Cactus Needle `.cact` sidecar has no Windows GPU inference provider, so it remains CPU-only and is reported that way. Adding a GPU inference engine or converting the model format is outside this change.
