## Context

Android media transcription today is Groq-only: `transcribe_audio_file_groq` (`src-tauri/src/commands/podcast.rs`) chunks local files and uploads them; podcast imports use the sibling cloud command. The on-device ML Kit plugin (`plethora-android-speech`) is lecture-capture-only, returns a single untimed segment, and is AICore-gated. The desktop Sherpa engine runs via sidecar binaries (`libwhisper.so`, onnxruntime) not shipped on Android. Meanwhile the Android TTS plugin already pins `com.github.k2-fsa:sherpa-onnx:1.13.4` (JitPack AAR, JNI bindings under `com.k2fsa.sherpa.onnx`), proving the native runtime in this build.

Prior analysis (this conversation) settled the engine choice: sherpa-onnx CPU over chunked ML Kit (ML Kit alpha exposes text only — no word timestamps — and refuses unlocked bootloaders/AICore-less devices), and over QNN/NPU builds (order of magnitude more efficient but a separate toolchain; deferred). Battery/thermal estimates for the chosen models: an 8-hour book costs roughly 5–20% of a flagship battery at full speed, less when paced.

## Goals / Non-Goals

**Goals:**
- Fully offline, key-free transcription of imported audiobooks and podcasts on Android.
- Timed segments in the existing `transcripts` / `transcript_segments` schema, indistinguishable from Groq output downstream (player sync, assistant, search).
- Bounded-memory streaming for hours-long files; checkpoint/resume on interruption.
- Thermal-friendly execution (foreground service, default-capped threading, user pacing control).
- Groq remains a first-class override and fallback; desktop and iOS paths untouched.

**Non-Goals:**
- iOS, desktop queue changes, speaker diarization, NPU/QNN builds, live/streaming mic transcription (ML Kit lecture capture keeps that role), re-transcription language switching UX.

## Decisions

### D1: New plugin `plethora-android-stt`, Kotlin owns the pipeline
A new Tauri plugin mirrors the existing plugin pattern (Rust shim registering `com.plethora.androidstt.AndroidSttPlugin`; non-Android commands return `platform_unsupported`). Kotlin owns decode → resample → VAD → recognize end-to-end in a foreground service; **no PCM crosses the Tauri IPC** — only control messages, status, and finished segments (as JSON) cross. Alternative — extending `plethora-android-speech` — rejected: that plugin is a thin ML Kit shim for short captures with a different engine, transport (base64 PCM), and lifecycle; merging them couples an alpha Google API to the long-form pipeline.

### D2: Rust orchestrates persistence via polling, not Kotlin DB access
Kotlin never touches SQLite. The Rust command `transcribe_audio_file_on_device` (mirrors the Groq command's signature: `document_id`, `file_path`, `language`, plus `model_id`, `pacing`) starts the job, then polls `stt_job_status` (~1s) which returns status + segments completed since a cursor. Rust persists segments incrementally with sqlx, emits `audiobook://transcription-progress`, and handles cancellation. Rationale: sqlx/migrations/repository stay in Rust; Kotlin stays stateless compute; polling through `run_mobile_plugin` is the same bridge pattern the sibling plugins use (no new event channel needed from Kotlin).

### D3: Decode via MediaCodec, downmix + resample in Kotlin
`MediaExtractor` + `MediaCodec` decode any supported container at its native rate; Kotlin downmixes to mono (channel average) and resamples to 16 kHz with a small anti-aliasing FIR + decimation, unit-tested against generated tones/sweeps. DRM-protected or undecodable input → typed `codec_unsupported` / `drm_protected` errors. Alternative — bundling ffmpeg-kit — rejected: the project is unmaintained and adds license weight for one resample step we can own. Output feeds the recognizer in ~30 s windows.

### D4: SenseVoice-small int8 default, Parakeet int8 English fast path
Catalog of two models initially (multilingual default + fast English), files downloaded from the k2-fsa/sherpa-onnx release artifacts (HF mirror acceptable), verified by expected size + SHA-256 before marked ready, stored in app-private files dir. Parakeet auto-selected when the configured transcription language is English and both models are ready; explicit choice always wins. Word timestamps come from recognizer token timings (Whisper/Parakeet family); if a model returns none, segments fall back to VAD-window boundary timestamps — schema stays populated either way.

### D5: VAD chunking with checkpoint table
Silero VAD (shipped in the same AAR) segments the PCM stream; recognizer runs per VAD segment; each finished segment is delivered to Rust and persisted immediately. Resume state (decode position in ms + segment cursor + model id) lives in a new `transcription_checkpoints` table keyed by document id, matching the Groq command's "existing segments survive interruption" contract. Silero VAD model file (~2 MB) ships inside the APK assets.

### D6: Foreground service, `mediaProcessing` where available
Foreground service with visible notification: `mediaProcessing` type on API 35+ (6 h/24 h cap — comfortable vs. ~0.5–2 h compute for 8 h audio at our RTFs), `dataSync` on older APIs. Jobs are started while the app is foregrounded (user initiates import), avoiding FGS background-launch restrictions. Pacing setting (Capped default = 2 threads; Full = 4 threads) is passed to the recognizer config; Capped is the default per the thermal analysis.

### D7: Routing and settings
`audioTranscription.provider` gains `"android-ondevice"`. Effective resolution on Android: explicit user choice wins; otherwise on-device when a model is ready, else Groq-if-keyed, else error surfaced in the queue UI. `AudiobookViewer` and podcast import call a shared frontend resolver that picks `transcribe_audio_file_on_device` vs `transcribe_audio_file_groq`. On-Device AI panel gains: model rows (status/download/delete/size), pacing selector, and the same capability-badge pattern used by the Apple/ML Kit rows. Podcast episodes not yet local are downloaded through the existing episode-download path before the job starts (network fetches media; transcription itself stays offline).

## Risks / Trade-offs

- [SenseVoice token timestamps may be sparse/absent] → fallback to VAD-boundary timestamps (D4); player sync granularity degrades to ~utterance level for that model only; Parakeet path unaffected.
- [AAR version drift vs. TTS plugin] → single comment-linked pin at 1.13.4 in both `build.gradle.kts` files; bump only in lockstep with a device test pass.
- [MediaCodec edge cases (odd M4B chapter containers, exotic codecs)] → typed errors + segment-preserving failure (spec scenario); bail to Groq fallback when configured.
- [Thermal throttling stretches wall-clock] → expected and harmless: checkpointing makes throttling/pauses resumable; pacing default keeps sustained draw low.
- [6 h/24 h `mediaProcessing` cap on API 35+] → compute estimates ≪ cap; if exceeded, service stops gracefully and the job resumes next window from checkpoint.
- [Model download size on constrained devices] → explicit user action + progress + delete; models live in app storage, removable from settings.
- [Battery cost misestimates on low-end hardware] → suitability check (RAM/SoC class) before offering Full pacing; docs in settings copy.
- [Perf gate] → no TS hot paths touched; if implementation adds any, update `scripts/perf-baselines.json` per protocol.

## Migration Plan

Ship dark: plugin registered and commands present but routing default unchanged until a model is downloaded and the user enables it (or auto-enable-on-first-ready, per spec default). Rollback = flip provider resolution; Groq path is untouched throughout. DB migration adds only the `transcription_checkpoints` table (additive, forward-compatible).

## Open Questions

- Model hosting: k2-fsa GitHub release artifacts vs. HF mirror — pick per checksum availability; resolve during implementation of the download command.
- Whether the desktop HF model-manager tables should also record Android STT models for cross-device status sync (nice-to-have; default no).
- Notification string/detail polish (progress %, cancel action) — defer to implementation.
