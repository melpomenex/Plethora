## Why

Local transcription using NVIDIA's Nemotron 3.5 ASR (GGUF) was recently introduced alongside a unified `TranscriptionService` and STT configuration (`sttProvider`, `sttModel`, `preferLocal`). However, Audiobooks and Podcasts still rely on legacy resolution logic and dedicated Groq commands that default or fall back to Groq cloud transcription even when local transcription is desired or Nemotron is installed. On desktop and supported environments, audiobooks and podcasts should seamlessly utilize the installed local Nemotron model (and other installed local STT models) without requiring Groq API keys or falling back to cloud services unexpectedly.

## What Changes

- **Unified STT Resolution for Audiobooks & Podcasts**: Update `src/lib/transcriptionProvider.ts` and `src/lib/transcriptionRouting.ts` to respect `sttProvider`, `sttModel`, `preferLocal`, and `mode` settings. When local STT is requested or when automatic routing with `preferLocal` is active, prioritize local Nemotron when installed and capable.
- **Model Profile & Quality Ranking Integration**: Add Nemotron ASR (`nemotron-3.5-asr-0.6b` and HF catalog identifiers) to model ranking and recognition in `transcriptionProvider.ts`, preventing false "model-not-installed" or "missing-groq-key" errors when local Nemotron is installed.
- **Audiobook & Podcast Frontend Routing**:
  - Update `src/components/viewer/AudiobookViewer.tsx` to route audiobooks and podcast episodes according to the resolved provider and model rather than hardcoding Groq as the default cloud path.
  - Update `src/components/media/PodcastManager.tsx` to invoke podcast transcription with the resolved engine.
  - Update `src/api/audiobooks.ts` (`generateTranscript`) and `src/components/import/AudiobookImportDialog.tsx` to support local Nemotron transcription instead of strictly branching between Groq and legacy Whisper.
- **Backend Model Resolution & Engine Dispatch in Rust**:
  - Update `src-tauri/src/commands/podcast.rs` (`run_transcription_job` / `transcribe_podcast_episode`): replace legacy model check and hardcoded Whisper/sherpa branching with HF model resolution (`resolve_installed_path`, `stt_route_for_model`) and `engine.transcribe_route(...)`, enabling Nemotron ASR for podcast episodes.
  - Update `src-tauri/src/commands/audiobook.rs` (`generate_audiobook_transcript`): support HF installed models and dispatch via `stt_route_for_model` and `engine.transcribe_route(...)`.
  - Update `src-tauri/src/models/hf/manager.rs`: normalize Nemotron logical keys (`nemotron-3.5-asr-0.6b` and `nvidia/nemotron-3.5-asr-0.6b`) in `resolve_installed_path`, `resolve_run_contract`, and `stt_route_for_model` so frontend logical keys map cleanly to the installed GGUF model.

## Capabilities

### New Capabilities
- `audiobook-podcast-stt-routing`: Unified speech-to-text routing for audiobooks and podcasts, seamlessly prioritizing local Nemotron ASR on capable hardware, honoring user STT provider preferences, and cleanly falling back across local models, on-device mobile engines, and cloud providers.

### Modified Capabilities
<!-- None: existing openspec specs do not specify audiobook/podcast STT routing requirements -->

## Impact

- **Frontend Services & Routing**: `src/lib/transcriptionProvider.ts`, `src/lib/transcriptionRouting.ts`, `src/lib/transcriptionResolutionFailure.ts`.
- **API & Components**: `src/api/audiobooks.ts`, `src/api/podcast.ts`, `src/components/viewer/AudiobookViewer.tsx`, `src/components/media/PodcastManager.tsx`, `src/components/import/AudiobookImportDialog.tsx`.
- **Rust Backend**: `src-tauri/src/commands/podcast.rs`, `src-tauri/src/commands/audiobook.rs`, `src-tauri/src/models/hf/manager.rs`, `src-tauri/src/transcription/engine.rs`.
- **User Experience**: Offline-first, key-free transcription of podcasts and audiobooks whenever local Nemotron is installed, without unconfigured Groq errors.
