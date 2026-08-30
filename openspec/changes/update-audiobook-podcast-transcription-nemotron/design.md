## Context

Plethora recently implemented local transcription using NVIDIA's Nemotron 3.5 ASR GGUF model via `src-tauri/src/transcription/nemotron.rs`, alongside a unified `TranscriptionService` and `TranscriptionRouter` that support settings such as `sttProvider` ("automatic", "local", "openrouter", "premium"), `sttModel`, and `preferLocal`.

However, Audiobooks and Podcasts were built earlier and rely on:
1. Legacy resolution in `src/lib/transcriptionProvider.ts`, which evaluates `audioSettings.provider` and defaults to checking `preferredModelId` (defaulting to `"distil-small.en"`).
2. Fixed ranking in `MODEL_QUALITY_RANK` that only contains Whisper and Sherpa models.
3. Fallback to Groq when the legacy model is not installed or when on mobile without an Android model.
4. Dedicated backend commands (`transcribe_podcast_episode` in `src-tauri/src/commands/podcast.rs` and `generate_audiobook_transcript` in `src-tauri/src/commands/audiobook.rs`) that only query `ModelManager::is_model_installed` and only branch to Whisper, SenseVoice, or Parakeet.

As a result, Audiobooks and Podcasts still default to Groq (or fail with missing Groq key / uninstalled Whisper model messages) even when Nemotron is installed and configured.

## Goals / Non-Goals

**Goals:**
- Update `src/lib/transcriptionProvider.ts` to integrate unified speech settings (`sttProvider`, `sttModel`, `preferLocal`, `mode`) and recognize installed Nemotron ASR.
- Prioritize local Nemotron as the primary local transcription engine on capable desktop hardware when `sttProvider` is `"local"` or `"automatic"` with `preferLocal: true`.
- Update `src/lib/transcriptionRouting.ts`, `src/components/viewer/AudiobookViewer.tsx`, and `src/components/media/PodcastManager.tsx` to route audiobook and podcast transcription through local Nemotron without forcing Groq.
- Update `src-tauri/src/commands/podcast.rs` and `src-tauri/src/commands/audiobook.rs` to resolve HF-installed models (including Nemotron) and dispatch via `stt_route_for_model` and `engine.transcribe_route(...)`.
- Normalize Nemotron model IDs (`nemotron-3.5-asr-0.6b`, `nvidia/nemotron-3.5-asr-0.6b`, and `hf:nemotron-asr:nvidia/nemotron-3.5-asr-0.6b@main`) in `src-tauri/src/models/hf/manager.rs`.

**Non-Goals:**
- Removing or disabling Groq cloud transcription: users who explicitly configure and choose Groq can still use it.
- Modifying video transcription queue or realtime streaming sessions (which already route through `TranscriptionService`).

## Decisions

### Decision 1: Enhance `resolveTranscription` with unified STT settings and Nemotron awareness
- **Rationale**: `AudiobookViewer`, `PodcastManager`, `DocumentsView`, and `AudiobookImportDialog` all consume `resolveTranscription` and its failure display helper `showTranscriptionResolutionFailure`. Enhancing `resolveTranscription` to incorporate `sttProvider`, `sttModel`, `preferLocal`, and `isLocalNemotronInstalled()` ensures all consumers automatically prioritize local Nemotron when available without breaking existing UI affordances.
- **Alternatives Considered**: Replacing `resolveTranscription` entirely with `TranscriptionRouter.selectProvider`. However, `resolveTranscription` performs platform-specific checks (e.g. Apple Speech, Android on-device) and returns rich failure structures (`missing-groq-key`, `model-not-installed`) consumed by UI dialogs. Augmenting `resolveTranscription` preserves those contracts.

### Decision 2: Model identifier normalization in Rust HF manager
- **Rationale**: The frontend settings define `LOGICAL_STT_MODEL_KEYS.NEMOTRON = "nemotron-3.5-asr-0.6b"`, while HF registry entries use `hf:nemotron-asr:nvidia/nemotron-3.5-asr-0.6b@main` and catalog entries use `nvidia/nemotron-3.5-asr-0.6b`. Normalizing these variants in `resolve_installed_path`, `resolve_run_contract`, and `stt_route_for_model` enables all parts of the Rust backend (`auto_queue`, `podcast.rs`, `audiobook.rs`) to resolve the installed GGUF path and contract transparently.
- **Alternatives Considered**: Forcing every frontend component to convert logical keys to full HF tags before calling backend commands. This would be brittle and prone to regressions whenever new entry points invoke transcription.

### Decision 3: Standardize Rust podcast & audiobook runners on `engine.transcribe_route(...)`
- **Rationale**: `auto_queue.rs` and `job_queue.rs` successfully route multiple model architectures using `crate::models::hf::manager::stt_route_for_model` and `engine.transcribe_route(...)`. Adopting this same pattern in `podcast.rs` (`run_transcription_job`) and `audiobook.rs` (`generate_audiobook_transcript`) unifies dispatch across Whisper, sherpa-onnx, and Nemotron GGUF models.

## Risks / Trade-offs

- **[Risk] Device Performance**: Nemotron 3.5 ASR GGUF requires modern hardware.
  - **Mitigation**: Check `canRunLocalNemotron()` in `transcriptionProvider.ts`. On constrained devices, fall back to installed Whisper/sherpa models or prompt the user, rather than causing high memory pressure.
- **[Risk] Long Podcast / Audiobook Transcriptions**: Audio files can be long and require progressive progress emission.
  - **Mitigation**: `run_transcription_job` and `engine.transcribe_route` already support throttled progress callbacks and chunked processing, which update the database and UI without overwhelming the Tauri IPC bridge.
