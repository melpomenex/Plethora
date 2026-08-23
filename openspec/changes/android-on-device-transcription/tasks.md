## 1. Plugin scaffold

- [x] 1.1 Create `src-tauri/plugins/plethora-android-stt/` (Cargo.toml, build.rs, permissions) following the `plethora-android-speech` pattern; non-Android commands return `platform_unsupported`
- [x] 1.2 Add Kotlin module (`com.plethora.androidstt.AndroidSttPlugin`) with command stubs: `sttStatus`, `sttStartJob`, `sttJobStatus`, `sttCancelJob`, `sttPrepareModel`, `sttListModels`, `sttDeleteModel`; wire Gradle with the pinned `com.github.k2-fsa:sherpa-onnx:1.13.4` (lockstep comment referencing the TTS plugin)
- [x] 1.3 Register the plugin in `src-tauri/src/lib.rs` and add capabilities/permissions entries; verify desktop build still compiles (`cargo check`) and Android stub commands reject with `platform_unsupported`

## 2. Kotlin decode pipeline

- [x] 2.1 Implement `MediaExtractor`+`MediaCodec` streaming decoder that reads a file URI and emits PCM frames at native rate in bounded-memory chunks; typed errors for `codec_unsupported` / `drm_protected`
- [x] 2.2 Implement mono downmix (channel average) and 16 kHz resample (anti-aliasing FIR + decimation)
- [x] 2.3 Unit tests (JVM): decode/resample correctness against generated tones (440 Hz sine, sweep), stereo→mono averaging, 44.1k/48k→16k resample, peak memory bound on synthetic long stream

## 3. Recognizer pipeline (Kotlin)

- [x] 3.1 Wrap sherpa-onnx `OfflineRecognizer` for SenseVoice-small int8 and Parakeet int8: model config loading from app storage, thread-count from pacing setting (Capped=2 default, Full=4)
- [x] 3.2 Integrate silero VAD (model in APK assets): segment PCM into utterances (cap ~30 s), run recognizer per segment, collect token/word timestamps; fall back to VAD-boundary timestamps when the model returns none
- [x] 3.3 Implement the job state machine: `startJob` (source URI, language, modelId, pacing, resume-from offset) → decode → VAD → recognize → buffer completed segments; `jobStatus` returns status/progress/segments-since-cursor; `cancelJob` stops promptly and keeps completed output
- [x] 3.4 Kotlin unit tests: state-machine transitions, cancel mid-stream, resume-from-offset, segment cursor correctness (JVM, mocked recognizer)

## 4. Model management

- [x] 4.1 Define the model catalog (id, display name, files, expected size, SHA-256, source URL) for sense-voice-small int8 and parakeet int8; resolve hosting (k2-fsa releases vs HF mirror) and record checksums
- [x] 4.2 Implement `sttPrepareModel` download in Kotlin: resumable partial-file download, progress reporting, size+SHA-256 verification before marking ready; `sttListModels`/`sttDeleteModel` manage app-storage files
- [x] 4.3 Model selection rule: Parakeet auto-selected for English when both ready, else SenseVoice default; explicit choice overrides

## 5. Foreground service

- [x] 5.1 Create the transcription foreground service: `mediaProcessing` type on API 35+, `dataSync` fallback below; visible notification with document title + progress; graceful stop at the 6 h/24 h cap leaving a resumable checkpoint
- [ ] 5.2 Verify screen-off/backgrounded execution and prompt cancel from the notification on a device/emulator

## 6. Rust orchestration

- [x] 6.1 Add `transcription_checkpoints` migration (document_id PK, model_id, decode_offset_ms, segment_cursor, updated_at) and repository helpers
- [x] 6.2 Implement `transcribe_audio_file_on_device` in `src-tauri/src/commands/podcast.rs`: start plugin job, poll `sttJobStatus` (~1 s), persist segments incrementally to `transcripts`/`transcript_segments`, write combined text to `documents.content` on completion, emit `audiobook://transcription-progress` (keyed by documentId, Groq-compatible payload), honor cancellation, resume from checkpoint
- [x] 6.3 Failure semantics: interrupted run marks status and preserves segments (match the Groq command's checkpoint contract); typed plugin errors surfaced to the queue UI
- [x] 6.4 Rust tests: checkpoint resume preserves prior segments, progress-event payloads, error mapping (using a mocked plugin response fixture)

## 7. Frontend routing, settings, i18n

- [x] 7.1 Extend `AudioTranscriptionSettings.provider` with `"android-ondevice"` (+ model + pacing preferences) with settings-store migration defaulting to current behavior until a model is ready
- [x] 7.2 Implement the shared provider resolver (explicit choice > on-device-if-ready > Groq-if-keyed > surfaced error) and route `AudiobookViewer` + podcast import through it; ensure non-local podcast episodes download via the existing episode path before an on-device job
- [x] 7.3 On-Device AI panel: model rows (status/size/download-with-progress/delete), model selection, pacing selector (Capped default / Full), capability badge via `sttStatus`
- [x] 7.4 i18n strings for all six locales (en/de/es/fr/ja/zh) for new settings + queue/fallback notices
- [x] 7.5 Frontend tests: resolver matrix (platform × provider × model-ready × groq-key), settings migration, panel rendering states

## 8. Validation

- [ ] 8.1 End-to-end on device/emulator: import an 8 h audiobook (or long fixture), transcribe on-device with pacing Capped; verify timed segments, player sync, assistant/search visibility, resume after mid-book kill, battery/thermal smoke check
- [ ] 8.2 Fallback matrix check: on-device disabled → Groq path byte-identical to pre-change behavior; desktop unchanged (`platform_unsupported`)
- [x] 8.3 Run `npm run bench:check` and `npm run test:scripts`; update `scripts/perf-baselines.json` only if a TS hot path changed
- [ ] 8.4 Build the release APK via the android-build skill flow and confirm service/notification behavior on a physical device
