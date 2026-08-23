## 1. Prerequisites and plugin seams

- [x] 1.1 Confirm `extend-ai-capability-routing-for-apple` plugin crate `src-tauri/plugins/plethora-apple-intelligence/` exists with non-Apple `platform_unsupported` stubs and reserved `apple_speech_*` names
- [x] 1.2 Confirm `AIErrorCategory` includes `PermissionDenied`, `FeatureDisabled`, `UnsupportedLanguage` in `src/lib/ai/errors.ts` (if A has not landed, coordinate — do not fork the union)
- [x] 1.3 Consume A’s platform capability `apple_speech_transcription` in `src/lib/platformCapabilities.ts` (do **not** register `on_device_apple_speech`). Extend tests without breaking the desktop/Android frozen snapshot.
- [x] 1.4 Allowlist plugin commands in `src-tauri/capabilities/default.json` if A did not already add `plethora-apple-intelligence:default`

## 2. Native SpeechAnalyzer bridge

- [x] 2.1 Add `ios/Sources/AppleSpeech.swift` using `SpeechAnalyzer` / `SpeechTranscriber` behind `@available(iOS 26.0, macOS 26.0, *)`; iOS 14 target must still compile
- [x] 2.2 Implement `apple_speech_status` (OS, availability, locale, AssetInventory installed/downloadable, mic permission, busy) with no download or capture side effects
- [x] 2.3 Implement `apple_speech_ensure_assets` as explicit user-initiated locale download with progress events
- [x] 2.4 Implement `apple_speech_transcribe_file` with `requestId`, sandbox/security-scoped URL, segment streaming, generic DTO mapping from `audioTimeRange`
- [x] 2.5 Implement live `apple_speech_start_live` / `apple_speech_stop_live` (mic requested at start, not launch)
- [x] 2.6 Implement `apple_speech_cancel`; suppress late events after terminal state
- [x] 2.7 Handle interruptions (call, `AVAudioSession` interruption), foreground/background: flush partials, do not auto-resume during a call
- [x] 2.8 Bound long recordings (duration or file size); map over-limit to `InputTooLarge`; keep persisted segments
- [x] 2.9 Forward commands from plugin `src/lib.rs`; non-Apple builds return `platform_unsupported`
- [x] 2.10 Enforce single in-flight Speech session (D-Apple-14) with queue or busy error

## 3. Generic transcript persistence

- [x] 3.1 Define shared TS types for generic segments + optional measured `WordTiming`s (no Speech framework types) in `src/lib/ai/appleSpeech.ts` or `src/api/transcription.ts`
- [x] 3.2 Add SQLite support for word timings (`words_json` or `transcript_words`) via a new migration in `src-tauri/src/database/migrations.rs`; keep `transcript_segments` `start_ms`/`end_ms`/`text`/`confidence`
- [x] 3.3 Drop word arrays that violate the `wordTimings.ts` positional length contract
- [x] 3.4 Set `transcripts.model_used` to a stable `apple-speech-transcriber` (+ locale), never a Swift type name
- [x] 3.5 Continue copying completed transcript text to `documents.content` as `job_queue.rs` does today

## 4. Resolver, routing, and job queue

- [x] 4.1 Extend `src/stores/settingsStore.ts` / `src/types/settings.ts` `AudioTranscriptionSettings.provider` with `"apple"`
- [x] 4.2 Change `src/lib/transcriptionProvider.ts` so native-mobile `local` prefers Apple when status is ready; Groq substitution only when Apple is unavailable and Groq is configured
- [x] 4.3 Update `describeResolution` copy: never say Groq is being used when Apple is
- [x] 4.4 Extend `src/lib/transcriptionRouting.ts` to route `provider: "apple"` into the job queue Apple backend (not Groq, not whisper sidecar)
- [x] 4.5 Add Apple branch in `src-tauri/src/transcription/job_queue.rs` that skips WAV/whisper `prepare_audio` and consumes plugin segment events into `spawn_segment_consumer`
- [x] 4.6 Wire `cancel_transcription_job` (`transcription/mod.rs`) to `apple_speech_cancel` for Apple jobs
- [x] 4.7 Call `ensureCloudAiDisclosure` only on Groq paths (`src/api/transcription.ts`, `groqTranscription.ts`) — Apple is local
- [x] 4.8 Update `AudioTranscriptionSettings.tsx`: do not force Groq tab on iOS when Apple speech is available; explain whisper-local vs Apple vs Groq honestly

## 5. Live lecture / voice note UX

- [x] 5.1 Add a capability-gated command palette entry (`CommandPalette.tsx` / `CommandCenter.tsx`) `record-lecture` with `capabilityId: "apple_speech_transcription"` that starts live capture into a new document
- [x] 5.2 Persist partial segments during live capture; stop/cancel/fail leave recoverable text
- [x] 5.3 Update `scripts/ios-overrides/privacy-manifest.json` `NSMicrophoneUsageDescription` for lecture/voice notes + disclosed cloud STT; do not hand-edit `gen/apple` as source of truth
- [x] 5.4 Optional post-process actions after complete: summarize / tags / cards via existing `runTask` ids only, default off

## 6. Tests

- [x] 6.1 Vitest `transcriptionProvider.test.ts`: Apple-ready local→apple; Apple-unready local→Groq substitution; explicit groq; desktop local unchanged; missing Groq key; no crash
- [x] 6.2 Fake `appleSpeech` unit tests: fixture audio → segments with timestamps; cancel; permission denied (no transcribe invoke); long/oversize → InputTooLarge; airplane/offline Apple still completes
- [x] 6.3 Word/segment timestamp ordering and ms mapping tests
- [x] 6.4 Rust tests: Apple jobs do not call whisper prepare; batch FIFO; cancel
- [x] 6.5 Update `transcriptionRouting.test.ts` for apple provider
- [x] 6.6 Document TestFlight matrix: incoming call, background, asset download, locale unsupported

## 7. Non-regression

- [x] 7.1 Desktop whisper/sherpa path and Groq explicit path unchanged
- [x] 7.2 TTS untouched
- [x] 7.3 Cancelled Apple jobs never fall back to Groq
- [x] 7.4 Diagnostics contain no transcript or audio content
