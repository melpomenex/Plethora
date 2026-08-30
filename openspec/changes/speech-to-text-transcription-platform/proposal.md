## Why

Plethora increasingly handles spoken content—lectures, voice notes, audiobooks, meetings, and language-learning audio—but transcription is fragmented across Whisper sidecars, Groq, and provider-specific code paths. There is no unified provider abstraction, no consistent local/cloud model identity, and no path to install NVIDIA Nemotron 3.5 ASR as a first-class local model through Plethora's existing model manager. Premium cloud ASR is expensive; OpenRouter Nemotron (~$0.01/hour) and local offline execution address cost and privacy. Speech recognition must become a platform capability with one API, normalized results, capability-driven routing, and extensible provider registration—not a collection of vendor integrations.

## What Changes

- Introduce a central `TranscriptionProvider` abstraction with capability advertisement, normalized results, streaming session interface, and normalized error types
- Add `TranscriptionService` and `TranscriptionRouter` for provider/model selection (Automatic, Local, OpenRouter, Premium) with privacy-aware fallback and cost guards
- Implement OpenRouter cloud ASR: Nemotron 3.5 (default), Qwen3 ASR 0.6B, Qwen3 ASR 1.7B, with dynamic capability-filtered model discovery and curated overrides
- Add **Nemotron 3.5 ASR 0.6B** to Plethora's existing local model manager (HF model registry) as an ASR capability—no separate ASR installer
- Implement `LocalTranscriptionProvider` that auto-detects installed ASR models (Nemotron, legacy Whisper/sherpa-onnx) and routes to native runtime (Tauri → Rust ASR layer → GGUF artifact)
- Add device capability gating and performance classification (Excellent/Good/Usable/Slow/Unsupported) for mobile and desktop
- Support local-first automatic routing when Nemotron is installed and device performance is adequate
- Enforce offline-only mode: never upload audio when user selects Local/Offline
- Add resumable long-form transcription jobs with chunked audio processing, transcript reconciliation, and background survival
- Add Speech-to-Text settings UX: provider, model, language, prefer-local, automatic-fallback toggles
- Wire transcript output into Plethora document workflow (search, seek, karaoke, flashcards)
- Target Android (Vulkan/CPU) and iOS (Metal/CPU) local Nemotron on supported hardware
- Refactor existing Groq and Whisper paths behind the provider interface during migration
- Implement using a **multi-agent adversarial workflow**: builder agents per phase, adversarial review agents (security/privacy, routing correctness, over-engineering) before phase gates
- **BREAKING**: `settings.audioTranscription` expands from `provider: 'local' | 'groq'` to provider-category + model selection with mode-based routing preserved for migration

## Capabilities

### New Capabilities

- `transcription-platform`: Core provider interface, normalized result types, error normalization, audio preprocessing, and `TranscriptionService` API boundary
- `transcription-routing`: Provider/model router, local-first automatic routing, capability matching, retry/backoff, fallback chains, privacy and cost guards, health deprioritization
- `transcription-jobs`: Resumable job persistence, chunked long-form processing, progress reporting, cancellation, background survival
- `transcription-openrouter`: OpenRouter ASR integration, dynamic model discovery with audio-capability filtering, Nemotron/Qwen models, credential reuse, pseudo-streaming
- `transcription-settings`: Provider/model/language settings, prefer-local and automatic-fallback toggles, privacy disclosure, BYOK, usage visibility
- `transcription-local-asr`: Nemotron in HF model manager, ASR runtime adapter, backend detection (CUDA/Vulkan/Metal/CPU), installed-model auto-detection, desktop local transcription
- `transcription-mobile`: Android/iOS capability gating, mobile Nemotron runtime, performance classification, install UX on supported devices

### Modified Capabilities

- `transcript-karaoke-sync`: Extend requirements for provider-generated transcripts with timestamp seek and word-level highlighting

## Impact

- **Frontend**: `src/services/transcription/` (partially implemented); settings panels; HF model manager ASR entries; `useTranscriptionService` migration; import/transcribe dialog
- **Tauri/Rust**: New Nemotron ASR runtime adapter; extend `HfRuntime` for ASR; `src-tauri/src/transcription/` streaming decode; mobile NDK/Metal backends; job checkpoint resume
- **Model manager**: Extend `hf_installed_models` registry with ASR capability metadata; pinned Nemotron catalog entry; no parallel ASR manager
- **Settings/Stores**: Provider/model selection in `settingsStore`; transcription queue extensions; usage accounting
- **Mobile**: Shared `LocalTranscriptionProvider` concept across Android/iOS/desktop; capability gate before install
- **Tests**: Unit tests for routing, reconciliation, capability gating, offline guarantees; integration tests OpenRouter + Local Nemotron; adversarial review gates per phase
- **Economics**: Default cloud cost target below $0.02/audio hour; premium providers gated; cost-class escalation blocked in automatic fallback
