## Why

Incremental reading, extract processing, and spaced repetition in Plethora demand long, intense focus sessions that lead to visual fatigue and cognitive strain. Existing cloud-based TTS solutions impose recurring subscription/API costs, internet dependency, latency spikes, and severe privacy exposure of personal notes, while existing local options lack expressive zero-shot voice cloning. Integrating Chatterbox as an isolated local sidecar daemon running a standardized OpenAI-compatible Audio API (`/v1/audio/speech`, `/v1/audio/voices`, `/v1/models`) provides zero-cloud-dependency, low-latency streaming TTS and zero-shot voice cloning from a 3–10 second audio reference, while ensuring plug-and-play interoperability with any local TTS server.

## What Changes

- **Standardized Local OpenAI-Compatible Speech API**: Expose industry-standard `/v1/audio/speech` (synthesis), `/v1/audio/voices` (voice cloning & catalog), and `/v1/models` from the local background daemon (`plethora-tts-daemon`), making it instantly swappable with third-party local engines (Kokoro, Speaches, Piper, LocalAI).
- **Chatterbox Sidecar Daemon & Lifecycle Management**: Add a managed local background daemon wrapping the Chatterbox ~0.5B parameter model with hardware acceleration (CUDA 12.x, Apple Silicon Metal/MPS, AMD ROCm, and INT8 CPU fallback), health check endpoints (`GET /health`), lazy initialization, and automatic crash recovery.
- **Streaming Audio Pipeline**: Implement high-throughput, low-latency streaming HTTP chunked transfer delivering 24kHz 16-bit PCM or Opus packets to the frontend Web Audio API with a Time-to-First-Audio (TTFA) $\le 450\text{ ms}$.
- **Text Normalization & Chunking Pipeline**: Build a robust Markdown/LaTeX/code-aware sentence splitting and normalization pipeline in Rust, stripping markdown formatting, verbalizing simple math symbols, handling code blocks, and pre-buffering upcoming chunks ($N+1$, $N+2$) for gapless playback.
- **Voice Cloning Studio**: Introduce in-app voice cloning enabling users to record audio (5–15 seconds via microphone) or import audio files (`.wav`, `.mp3`, `.m4a`, `.flac`), perform RMS normalization and silence trimming, compute speaker conditioning latents, and persist reusable voice profiles via the standard `/v1/audio/voices` endpoint.
- **Model Asset Provisioning**: Implement on-demand model download and integrity verification within Settings so base application installers remain lightweight ($\le 1.2\text{ GB}$ model download footprint).
- **Auditory Reading UI & DAQE Synchronization**: Provide karaoke-style sentence/word tracking and auto-scroll in the reading view, study keyboard controls (`Space`, `J`/`K`, `[`/`]`, `E`), and bidirectionally sync playback completion with Plethora's DAQE queue scheduling.

## Capabilities

### New Capabilities
- `chatterbox-sidecar-daemon`: Standardized OpenAI-compatible HTTP daemon (`/v1/audio/speech`, `/v1/audio/voices`, `/v1/models`), lifecycle management, hardware acceleration auto-detection (CUDA, MPS, ROCm, CPU), health checks, and fault recovery.
- `chatterbox-voice-cloning`: Reference audio recording, file import, audio normalization, zero-shot speaker embedding extraction, and persistent local voice profile storage via standard voice endpoints.
- `chatterbox-text-normalization`: Markdown stripping, math/code pronunciation handling, sentence splitting, and multi-chunk pre-buffering pipeline for gapless playback.
- `chatterbox-reading-sync-daqe`: Real-time karaoke-style sentence highlighting, auto-scrolling viewport, audio playback keyboard shortcuts, quick extract generation from spoken audio, and DAQE queue advancement.

### Modified Capabilities

None. Existing specs in `openspec/specs/` remain unmodified.

## Impact

- **Plethora Core / Rust Backend**: New module `src-tauri/src/tts/chatterbox/` or sidecar process supervisor, Tauri commands for voice profile CRUD, model downloading, and sidecar supervision.
- **Sidecar Daemon**: New standalone binary/daemon target (`plethora-tts-daemon`) serving the standardized OpenAI-compatible API and packaging Chatterbox inference using ONNX Runtime / LibTorch.
- **Frontend State & UI (`src/`)**: Enhanced OpenAI-compatible provider adapter (`src/api/tts/providers/openai-compatible.ts`) with voice cloning support and local daemon connection, Voice Cloning Studio modal, and reading pane karaoke text synchronizer.
- **DAQE & Storage**: SQLite tables for local voice profiles (`id`, `name`, `embedding_path`, `config_json`) and playback event hooks updating DAQE item review states.
- **Platform Dependencies**: Dynamic loading of CUDA / MPS / ROCm runtimes where available with graceful fallback to INT8 quantized CPU execution.
