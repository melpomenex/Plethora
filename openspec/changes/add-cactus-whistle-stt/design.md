## Context

Plethora supports on-device speech-to-text (STT) for audiobooks and podcasts using `whisper.cpp` (desktop ggml) and `sherpa-onnx` (desktop Nemotron/Parakeet/SenseVoice; Android SenseVoice/Parakeet). However:
1. Existing local desktop models are large: Nemotron 3.5 requires 4 ONNX files totaling ~682 MB, and Whisper base is ~140 MB.
2. On mobile (Android), Nemotron cannot run due to lack of streaming sidecars, and Whisper is not packaged on mobile, forcing mobile users without Groq cloud API keys to fall back to SenseVoice or fail resolution.
3. Cactus Compute released **Whistle**, a companion STT model for the Cactus Needle engine. Whistle is packaged as a single 16.9 MB `.cact` container running on CPU across desktop and mobile, with prebuilt standalone binaries and static libraries (`needle` / `libneedle.a`) published for Linux (x86_64, aarch64, armv7), macOS (arm64), Windows (x64, arm64), and Android (arm64, armv7).

## Goals / Non-Goals

**Goals:**
- Provide a unified, lightweight (<20 MB total footprint) local STT solution on **every** platform Plethora supports: Linux (x86_64, ARM64), macOS (Apple Silicon & Intel via Rosetta/wheels), Windows (x64, ARM64), and Android (arm64, armv7).
- Download and verify `whistle.cact` via the Hugging Face model manager on desktop and the Android STT model manager on mobile.
- Provision the standalone `needle` engine as a Tauri `externalBin` sidecar across desktop target triples.
- Support word-level timestamps (`--audio-word-timestamps`), language detection, and language overrides across the 7 supported European languages (`en`, `de`, `fr`, `es`, `it`, `nl`, `pl`).
- Integrate Whistle into the audio transcription settings UI and the unified resolution logic in `transcriptionProvider.ts` so mobile users can transcribe fully offline without Groq keys.

**Non-Goals:**
- Replacing existing Nemotron or Whisper models (Whistle is an additional, high-speed, lightweight option).
- Tool-calling or agentic reasoning via Needle (we only utilize Whistle speech-to-text features in this change).
- Languages outside Whistle's 7 supported languages (for unhandled languages, transcription routing falls back to multilingual SenseVoice, Nemotron, Whisper, or cloud).

## Decisions

### D1: Sidecar Binary (`externalBin`) for Desktop vs Dynamic Library
- **Decision**: Package the standalone `needle` binary as a Tauri `externalBin` (`needle-<target-triple>`) provisioned via `scripts/download-sidecars.js` from `Cactus-Compute/needle3`.
- **Rationale**: The standalone `needle` executable is statically linked, small (~1.5 MB), requires zero runtime dependencies (no ONNX runtime or external DLLs), and matches Plethora's existing sidecar architecture (`whisper`, `sherpa-onnx`, `sherpa-online`).
- **Alternatives Considered**:
  - *C FFI / CDLL*: Calling `libneedle.so` / `libneedle.dylib` via Rust FFI (`libloading`). While possible, packaging DLLs/dylibs across Windows/macOS/Linux requires complex rpath/codesigning/loader configurations, whereas Tauri's `externalBin` tooling already handles sidecar permissions, path resolution, and signing cleanly.

### D2: Hugging Face Model Management via Dedicated Runtime Adapter
- **Decision**: Introduce `HfRuntime::WhistleStt` in `src-tauri/src/models/hf/adapters.rs` that identifies repos with `whistle.cact` (specifically `Cactus-Compute/whistle`).
- **Rationale**: Plethora's `HfManager` already provides robust resume, SHA-256 verification, cancellation, and progress emission for Hugging Face downloads. By implementing the `RuntimeAdapter` trait, Whistle integrates into model listing, disk space calculation, and deletion workflows automatically.

### D3: Android Execution via Bundled Executable / Private Storage
- **Decision**: In `plethora-android-stt`, download `whistle.cact` to internal app storage (`context.filesDir`), package the prebuilt `android-arm64/needle` and `android-armv7/needle` binaries in Android native assets/lib directory, and invoke the runner via process execution in `SttJobManager.kt`.
- **Rationale**: Android allows executing binaries located in application private executable directories (`context.applicationInfo.nativeLibraryDir` or `chmod +x` in `filesDir`). This keeps the execution model unified across desktop and mobile while avoiding heavyweight JNI binding boilerplate.

### D4: Output Parsing and Chunking Pipeline
- **Decision**: Invoke `./needle --model whistle.cact --audio <chunk.wav> --audio-word-timestamps` and parse the JSON stdout:
  `{"text": "...", "language": "en", "ttft_ms": ..., "decode_tps": ..., "words": [{"word": "...", "start": 0.0, "end": 0.45, "probability": 0.98}]}`.
- **Rationale**: For audio files longer than 30 seconds (Whistle's single-pass window), Plethora's existing 30-second chunking rail (`transcribe_in_chunks` in `engine.rs`) slices the audio with ffmpeg, passes 30-second WAV chunks to `needle`, and offsets the word/segment timestamps monotonically.

### D5: Model Quality Ranking and Fallback Order
- **Decision**: Insert `cactus-whistle` in `MODEL_QUALITY_RANK` in `transcriptionProvider.ts`. On desktop, Nemotron 3.5 remains the top pick on high-performance GPUs, while Whistle is prioritized for speed and low memory; on mobile (Android), Whistle is prioritized as the primary offline model when downloaded.

## Risks / Trade-offs

- **[Risk] Upstream binary availability or platform architecture changes**
  → *Mitigation*: Pin the download URL and commit SHA-256 for each platform binary in `scripts/download-sidecars.js`. Fail closed with descriptive error messages if sidecar verification fails.
- **[Risk] Single-pass 30-second audio duration limit in Whistle engine**
  → *Mitigation*: Use Plethora's established audio chunking pipeline in `engine.rs`, ensuring long podcasts and audiobooks are partitioned into <=30s segments with ffmpeg and reassembled with accurate cumulative timestamps.
- **[Risk] Unsupported languages (outside en, de, fr, es, it, nl, pl)**
  → *Mitigation*: When an explicit unsupported language is selected in settings, transcription routing falls back to multilingual SenseVoice, Nemotron, or Groq, with an informative note in the UI.

## Migration Plan

1. **Sidecar download**: Running `npm run sidecars:download` fetches `needle` for the current platform into `src-tauri/bin/`.
2. **Model install**: Whistle appears in Settings > Audio & Speech > Models & Profiles. Users click "Install" to fetch the 16.9 MB `whistle.cact`.
3. **Rollback**: If `needle` is not provisioned or `whistle.cact` is uninstalled, transcription automatically falls back to existing Nemotron, Whisper, or cloud routing.
