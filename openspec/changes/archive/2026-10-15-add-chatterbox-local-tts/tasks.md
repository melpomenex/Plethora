## 1. Standardized Local Daemon & Inference Engine

- [x] 1.1 Implement `plethora-tts-daemon` entry point exposing standardized OpenAI-compatible HTTP endpoints (`/v1/audio/speech`, `/v1/audio/voices`, `/v1/models`, `/health`) on a dynamically assigned port; verify with `curl http://localhost:<port>/health`.
- [x] 1.2 Implement hardware execution provider auto-detection (CUDA 12.x, Apple Metal/MPS, AMD ROCm, and INT8 CPU fallback); verify provider detection logs on host hardware.
- [x] 1.3 Implement voice cloning endpoint `POST /v1/audio/voices` accepting multipart audio and extracting speaker conditioning latent vector; verify extraction returns registered voice ID.
- [x] 1.4 Implement streaming synthesis endpoint `POST /v1/audio/speech` supporting chunked 24kHz 16-bit PCM and Opus output with TTFA $\le 450\text{ ms}$; verify latency and streaming audio format via integration test.
- [x] 1.5 Implement cancellation handler terminating in-flight generation within 50 ms upon client disconnect or abort command; verify cancellation promptness in synthetic test.

## 2. Model Asset Management & Provisioning

- [x] 2.1 Implement model asset directory structure and SHA-256 verification routine in Rust; verify integrity check catches corrupted or missing files.
- [x] 2.2 Implement on-demand model downloader with resumable streaming and byte-level progress reporting via Tauri events; verify download and verification end-to-end.
- [x] 2.3 Implement Settings UI controls for model download, storage accounting, and deletion; verify status changes and progress bar in UI.

## 3. Rust Core Lifecycle Manager & Sidecar Bridge

- [x] 3.1 Implement sidecar process lifecycle supervisor (spawn on demand, health-check poll, clean termination); verify daemon spawns on demand and terminates on app exit.
- [x] 3.2 Implement auto-recovery watchdog that detects process crash and restarts daemon within 2 seconds without dropping application state; verify crash simulation recovers automatically.
- [x] 3.3 Implement Tauri commands (`chatterbox_status`, `chatterbox_start`, `chatterbox_stop`); verify commands respond with typed DTOs.
- [x] 3.4 Implement SQLite schema and CRUD repository for voice profiles (id, name, description, avatar, speed, embedding_path, content_types); verify database migrations and CRUD unit tests.

## 4. Text Normalization & Chunking Pipeline

- [x] 4.1 Implement Markdown and formatting stripper (cleaning links, emphasis, images, headers); verify unit tests on diverse Markdown extracts.
- [x] 4.2 Implement spoken LaTeX math translator (converting common math symbols like $\in, \frac{a}{b}, \le, \sum$ to readable English phrases); verify math conversion test suite.
- [x] 4.3 Implement code block normalizer with configurable modes ("Announce Summary", "Read Aloud", "Skip"); verify outputs match user preference settings.
- [x] 4.4 Implement abbreviation-aware sentence splitter preserving source document `[startOffset, endOffset]`; verify boundary correctness on abbreviations like "Dr.", "e.g.", "i.e.".
- [x] 4.5 Implement multi-chunk lookahead pre-buffering coordinator ($N+1$, $N+2$ background synthesis); verify seamless chunk queuing in simulation test.

## 5. Web Audio Player & Voice Cloning Studio Frontend

- [x] 5.1 Enhance `src/api/tts/providers/openai-compatible.ts` to support local streaming endpoints, voice enrollment, and zero-shot voice ID selection; verify provider adapter tests.
- [x] 5.2 Implement Web Audio API streaming player handling 24kHz PCM / Opus chunks with 20ms boundary cross-fade; verify continuous audio playback without audible clicks.
- [x] 5.3 Build Voice Cloning Studio UI modal with WebRTC microphone recording (5–15s), live waveform visualizer, and file import (`.wav`, `.mp3`, `.m4a`, `.flac`); verify recording and file selection.
- [x] 5.4 Implement audio preprocessing (RMS normalization to -20 dBFS, noise gate, silence trimming); verify processed audio duration and amplitude.
- [x] 5.5 Implement voice profile manager UI (listing voices, setting default, 1-click test phrase audition, deleting profiles, assigning to collections); verify UI interactions and persistence.

## 6. Auditory Incremental Reading & DAQE Synchronization

- [x] 6.1 Implement karaoke-style visual highlighting of active spoken sentence using character offsets with auto-scrolling reading viewport; verify highlight and scroll behavior during playback.
- [x] 6.2 Implement study hotkeys (`Space` for play/pause, `J`/`K` for sentence jump, `[`/`]` for speed adjustment, `E` for extract creation); verify key event listeners and state updates.
- [x] 6.3 Implement DAQE audio review hooks to mark extracts consumed, record listening duration, and update spaced repetition intervals upon playback completion; verify DAQE queue state updates.
- [x] 6.4 Implement auto-advance queue mode when current audio completes; verify transition to next scheduled queue item.

## 7. End-to-End Verification & Performance Benchmarks

- [x] 7.1 Verify TTFA $\le 450\text{ ms}$ and RTF $\le 0.35$ on consumer GPU with benchmark test suite; verify perf test metrics pass.
- [x] 7.2 Run automated unit and integration tests across Rust backend and React frontend (`npm run test:scripts`, `vitest`, `cargo test`); verify all tests pass.
- [x] 7.3 Run performance benchmark gate `npm run bench:check`; verify no regression against baselines.
