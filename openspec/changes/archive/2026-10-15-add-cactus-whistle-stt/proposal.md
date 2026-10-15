## Why

Audiobook and podcast transcription currently relies on heavy local models (Whisper ggml at ~140–495 MB or Nemotron 3.5 ONNX at ~682 MB) or cloud fallbacks (Groq API, OpenRouter). On mobile devices and resource-constrained laptops, running these models either consumes excessive memory and battery or fails due to missing platform sidecars.

Cactus Compute's **Whistle** is an ultra-lightweight (16.9 MB) speech-to-text model sharing the unified Cactus Needle C++ runtime (`.cact` container format). It delivers 6.6× faster time-to-first-token than Whisper base with lower word-error rates across multiple benchmarks, supporting English, German, French, Spanish, Italian, Dutch, and Polish with optional word-level timestamps. Prebuilt standalone binaries and static libraries are available directly for every target Plethora supports (macOS arm64, Linux x86_64/arm64, Windows x64/arm64, and Android arm64/armv7). Adding Whistle gives Plethora users an instant, ultra-fast, offline on-device STT engine on all desktop and mobile platforms without external cloud dependencies.

## What Changes

- **Sidecar & Native Engine Provisioning**:
  - Add `needle` executable provisioning to `scripts/download-sidecars.js` for desktop targets (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`) sourced from `Cactus-Compute/needle3` on Hugging Face.
  - Update `src-tauri/tauri.conf.json` and verification scripts (`verify-transcription-sidecars.mjs`, `verify-deb-bundle.sh`, `verify-macos-bundles.sh`) to package `needle` as an `externalBin`.
  - Provide Android native binary/runner integration within `plethora-android-stt` for `android-arm64` and `android-armv7`.
- **Hugging Face Model Manager & Catalog**:
  - Add `WhistleStt` to `HfRuntime` in `src-tauri/src/models/hf/adapters.rs` and `manager.rs`, recognizing `whistle.cact` (16.9 MB) from `Cactus-Compute/whistle`.
  - Register Whistle in the logical STT model registry (`src/services/transcription/config.ts`), model quality rankings, and catalog definitions.
- **Backend Transcription Dispatch**:
  - Introduce `SttEngineRoute::Whistle { model: PathBuf }` in `src-tauri/src/transcription/mod.rs` and `engine.rs`.
  - Implement execution of `./needle --model whistle.cact --audio <wav> [--audio-language <lang>] [--audio-word-timestamps]` and parse structured JSON results into timestamped transcript segments.
- **Android On-Device Transcription Integration**:
  - Add Whistle manifest to Android's `SttModelRegistry.kt` (`cactus-whistle-cact`), enabling one-tap download and on-device execution on Android phones and tablets.
- **Frontend Settings & Provider Routing**:
  - Update `transcriptionProvider.ts` to recognize Whistle for both desktop and mobile platforms, removing mobile local transcription gating when Whistle is installed.
  - Expose Whistle in Audio Transcription Settings with download and management controls.

## Capabilities

### New Capabilities
- `whistle-stt-runtime`: On-device speech-to-text inference using Cactus Whistle (`whistle.cact`, 16.9 MB) via the Cactus Needle native engine across all desktop targets (Linux x86_64/ARM64, macOS, Windows) and Android mobile targets, including sidecar provisioning, CLI execution, word timestamps, and error recovery.

### Modified Capabilities
- `audiobook-podcast-stt-routing`: Update unified speech-to-text configuration, model catalog ranking, and execution routing to prioritize Whistle when installed and enable local on-device transcription on Android without falling back to cloud providers.

## Impact

- **Rust Backend**:
  - `src-tauri/src/models/hf/adapters.rs` & `manager.rs`: New `HfRuntime::WhistleStt` adapter detecting `whistle.cact`.
  - `src-tauri/src/transcription/engine.rs` & `mod.rs`: Engine dispatch for Needle/Whistle CLI sidecar.
  - `src-tauri/tauri.conf.json` & `build.rs`: Sidecar declarations for `needle`.
- **Packaging & Provisioning Scripts**:
  - `scripts/download-sidecars.js`: Download and extract `needle` sidecar for supported target triples.
  - `scripts/verify-transcription-sidecars.mjs`, `scripts/verify-deb-bundle.sh`, `scripts/verify-macos-bundles.sh`: Include `needle` in sidecar verification checks.
- **Android Plugin**:
  - `src-tauri/plugins/plethora-android-stt`: Register Whistle model in `SttModelRegistry.kt`, adapt `SttRecognizerEngine.kt` / `SttJobManager.kt` to run Whistle inference.
- **Frontend & Settings**:
  - `src/services/transcription/config.ts`: Add Whistle logical key and provider configuration.
  - `src/lib/transcriptionProvider.ts`: Allow local resolution on mobile when Whistle is installed.
  - `src/components/settings/AudioTranscriptionSettings.tsx`: Display Whistle status and download options.
