## Context

Plethora currently supports local TTS via Pocket TTS on desktop (via a provisioned Python CLI sidecar) and Sherpa-ONNX on Android, as well as cloud-based TTS (Fal.ai, OpenRouter, ElevenLabs, OpenAI) and an OpenAI-compatible adapter (`src/api/tts/providers/openai-compatible.ts`). While Pocket TTS provides basic offline playback, it lacks zero-shot voice cloning and fine-grained streaming synthesis. Users studying via incremental reading require auditory support for long sessions without leaking private study material to cloud APIs.

Chatterbox is an open-source (~0.5B parameter, MIT-licensed) TTS model designed for zero-shot voice cloning from short audio references (3–10 seconds) with low-latency inference on consumer hardware (CUDA, Metal/MPS, ROCm, and AVX2 CPU).

By implementing the industry-standard **OpenAI Audio Speech API** (`POST /v1/audio/speech`, `POST /v1/audio/voices`, `GET /v1/models`) on the local daemon, Plethora creates a plug-and-play architecture that supports Chatterbox out-of-the-box while allowing users to connect to any other local engine (Kokoro-FastAPI, Speaches, LocalAI, Piper) with zero code changes.

See `proposal.md` for motivation and high-level objectives.

## Goals / Non-Goals

**Goals:**
- Implement a 100% offline, standardized OpenAI-compatible local API (`POST /v1/audio/speech`, `GET /v1/models`, `POST /v1/audio/voices`) that makes Plethora interoperable with any local TTS engine.
- Deliver low-latency audio streaming: Time-to-First-Audio (TTFA) $\le 450\text{ ms}$, Real-Time Factor (RTF) $\le 0.35$ on consumer GPUs (NVIDIA RTX 3060 / Apple Silicon M-series).
- Isolate the Chatterbox inference engine into a managed sidecar daemon (`plethora-tts-daemon`) to ensure 0% app crashes from out-of-memory or model faults.
- Provide a Voice Cloning Studio UI for microphone recording (5–15s) and file upload (WAV/MP3/M4A/FLAC), automated preprocessing (RMS norm, silence trimming), and latent vector persistence via standard voice endpoints.
- Implement an intelligent Rust text normalizer that cleans Markdown, translates simple math expressions, handles code blocks, and retains source text character offsets.
- Synchronize audio playback with visual karaoke sentence highlighting, auto-scroll, study hotkeys (`Space`, `J`/`K`, `[`/`]`, `E`), and DAQE queue completion hooks.

**Non-Goals:**
- Mobile (Android / iOS) execution of Chatterbox in this phase: Chatterbox requires ~3.2 GB VRAM/RAM under FP16/INT8; mobile continues to use the lightweight Sherpa-ONNX KittenTTS/Kokoro plugin.
- Cloud synchronization or public sharing of cloned voice embeddings: All audio samples, latent tensors, and voice profiles remain strictly local on the user's disk.
- Multi-speaker conversational generation: Chatterbox is integrated purely as a single-voice incremental reader and reviewer.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Plethora Frontend (React)                   │
│  - Playback Controls & Highlight Tracking                   │
│  - Voice Profile Manager (Clone / Record / Test)            │
│  - Standardized OpenAI-Compatible Client Adapter            │
│  - Web Audio Context (Streaming PCM/Opus Player)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC / Events
┌──────────────────────────────▼──────────────────────────────┐
│                  Plethora Core (Rust / Tauri)               │
│  - Process Lifecycle Supervisor (Spawn, Heartbeat, Restart) │
│  - Text Normalization & Sentence Splitting Pipeline         │
│  - Multi-Chunk Lookahead Pre-Buffering Coordinator          │
│  - DAQE Playback State & Progress Synchronization           │
│  - Local Voice Profiles & Metadata Store (SQLite)           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Standard HTTP API (OpenAI-compatible)
┌──────────────────────────────▼──────────────────────────────┐
│       Local TTS Daemon (Chatterbox / Speaches / Kokoro)     │
│  - Endpoint: POST /v1/audio/speech                          │
│  - Endpoint: POST /v1/audio/voices                          │
│  - Endpoint: GET /v1/models                                 │
│  - Endpoint: GET /health                                    │
│  - Hardware Backend: CUDA 12.x / MPS / ROCm / CPU (INT8)    │
│  - Zero-Shot Speaker Encoder (Latent Extraction)            │
│  - Streaming Chunk Synthesizer (24kHz 16-bit PCM / Opus)    │
└─────────────────────────────────────────────────────────────┘
```

## Decisions

### 1. Standardized OpenAI-Compatible API (`POST /v1/audio/speech`)
- **Decision:** Expose the industry-standard OpenAI audio API from `plethora-tts-daemon` and enhance Plethora's existing `openai-compatible.ts` provider adapter to communicate with it.
- **Rationale:** Rather than inventing a custom IPC schema, adopting the OpenAI speech format (`model`, `input`, `voice`, `response_format`, `speed`) ensures Plethora can effortlessly switch between the bundled Chatterbox engine and any existing local server (such as Kokoro-FastAPI, Speaches, Piper, or LocalAI) running on `http://127.0.0.1:<port>`.
- **Alternatives considered:**
  - *Proprietary binary IPC protocol:* Would tightly couple Plethora to Chatterbox and prevent users from reusing other local models.

### 2. Standardized Voice Cloning Endpoint (`POST /v1/audio/voices`)
- **Decision:** Implement standard multipart voice enrollment (`name`, `file`, `description`) returning `{ id, name, created_at }`.
- **Rationale:** Mirrors the voice management convention established by ElevenLabs and Speaches. Cloned voice IDs can immediately be passed as the `voice` parameter in `POST /v1/audio/speech`.

### 3. Managed External Sidecar Daemon vs. In-Process Rust ML Runtime
- **Decision:** Run Chatterbox inside an isolated background daemon process (`plethora-tts-daemon`), supervised by Plethora's Rust backend.
- **Rationale:** Deep learning inference runtimes (PyTorch / ONNX Runtime / CUDA / MPS) carry large binary footprints and allocate several gigabytes of VRAM/RAM. Isolating inference in a separate process guarantees that Plethora's desktop app UI and database never crash if the TTS engine faults.

### 4. Rust-Side Text Normalization & Sentence Offset Mapping
- **Decision:** Implement text preprocessing, Markdown stripping, math notation verbalization, and sentence chunking directly in `plethora-core` (Rust).
- **Rationale:** Running text normalization in Rust guarantees microsecond execution speeds, predictable regular expression execution, and exact character byte offset calculations (`[startOffset, endOffset]`) corresponding directly to Plethora's document DOM nodes for highlighting. Chunks are dispatched sequentially to `POST /v1/audio/speech` with pre-buffering.

### 5. On-Demand Model Asset Provisioning
- **Decision:** Model weights ($\le 1.2\text{ GB}$) are downloaded on demand within Settings with SHA-256 checksum verification and chunked progress streaming.
- **Rationale:** Keeps the initial Plethora desktop installer small and allows users to choose whether to install the Chatterbox engine.

## Risks / Trade-offs

- **[Risk] Packaging Python vs. Native Runtime Complexity**
  - *Mitigation:* In Phase 1, ship the daemon using a standalone PyInstaller / virtualenv bundle with pinned ONNX Runtime / LibTorch wheels. In Phase 2, explore compiling the ONNX Runtime model into a single native C++ binary to eliminate Python runtime dependencies.
- **[Risk] Inter-Sentence Audio Jitter & Micro-Gaps**
  - *Mitigation:* Implement a lookahead pre-buffering pipeline that synthesizes chunk $N+1$ and $N+2$ while chunk $N$ is playing. Apply a subtle $20\text{ ms}$ linear cross-fade envelope at chunk boundaries to eliminate audio popping.
- **[Risk] VRAM Exhaustion on Low-Memory GPUs (<4 GB free)**
  - *Mitigation:* The daemon's `GET /health` endpoint checks available VRAM at startup. If $< 4\text{ GB}$ is available, the daemon logs a warning and automatically activates INT8 dynamic CPU quantization.
- **[Risk] Reading Viewport Highlight Drift**
  - *Mitigation:* Sentence boundaries are indexed against raw document text before synthesis. The audio stream emits sentence index marks that trigger discrete DOM class transitions and debounced `scrollIntoView({ behavior: 'smooth', block: 'center' })`.

## Migration Plan

1. Chatterbox local TTS is introduced as an opt-in provider alongside Pocket TTS, System TTS, and Cloud TTS in `Settings > Text to Speech`.
2. Existing voice settings, review queues, and cached audio files from other providers remain untouched.
3. If Chatterbox model assets are not downloaded, the UI displays a "Download & Provision" action without interrupting active study.
