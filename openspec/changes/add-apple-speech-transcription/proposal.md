## Why

On native mobile, `src/lib/transcriptionProvider.ts` `resolveTranscription` **silently remaps** `provider: "local"` to Groq (`substitution: "mobile-no-local"`). Callers (`src/lib/transcriptionRouting.ts`, `src/api/audiobooks.ts`, `src/components/media/PodcastManager.tsx`, `src/components/documents/DocumentsView.tsx`, `src/components/settings/AudioTranscriptionSettings.tsx`) then upload audio whenever a Groq key exists. iOS cannot run whisper.cpp / sherpa sidecars from `src-tauri/src/transcription/engine.rs`, so "Local STT" is a lie.

iOS/macOS 26 `SpeechAnalyzer` + `SpeechTranscriber` are on-device (not Apple Intelligence), locale assets via `AssetInventory`, and they emit `audioTimeRange` timestamps. They are the replacement for that substitution. Without a generic (non-Apple) transcript shape that already matches `TranscriptSegment` / `WordTiming`, later text↔audio navigation (karaoke in `src/utils/wordTimings.ts`, `TranscriptPanel.tsx`) is blocked.

## What Changes

- Implement Swift `AppleSpeech` inside the **existing** plugin crate `src-tauri/plugins/plethora-apple-intelligence/` (skeleton from `extend-ai-capability-routing-for-apple`). Commands are namespaced `apple_speech_*`.
- Add TypeScript SDK `src/lib/ai/appleSpeech.ts` (invoke only `plugin:plethora-apple-intelligence`). Features keep calling `resolveTranscription` / `routeDocumentTranscription` / the existing `JobQueue` — **not** a parallel STT stack (D-Apple-1, D-Apple-11).
- Change `resolveTranscription` so that on iOS/macOS 26+ when Speech assets are ready, settings `local` **or** a new `apple` provider value prefer on-device Apple speech. Groq remains opt-in, disclosed via `src/lib/privacy/cloudAiDisclosure.ts` (`featureClass: "transcription"`). If Apple is unavailable: Groq **only if** configured **and** disclosed; else existing desktop local whisper path; never crash the app.
- Two product modes: **imported audio file** (library / share / picker) and **live lecture / voice note** (microphone). Live needs `NSMicrophoneUsageDescription` update in `scripts/ios-overrides/privacy-manifest.json` (injected into `src-tauri/gen/apple/plethora-tauri_iOS/Info.plist` — do not edit gen/apple as source of truth).
- Persist results as the **generic** transcript model (`transcripts` + `transcript_segments` in `src-tauri/src/database/migrations.rs`, optional word timings compatible with `src/utils/wordTimings.ts`). Map Apple `audioTimeRange` → `start_ms` / `end_ms`. Never store Speech framework types in SQLite or TS stores.
- Hook Apple file jobs into `src-tauri/src/transcription/job_queue.rs` as a backend route (same events: `transcription://status-change`, `transcription://segments-batch`, `transcription://idle`). Live sessions use plugin events with the same segment DTO, then persist through the same tables.
- Reliability: interruption / incoming call, backgrounding, permission denied, partial persist, cancel, thermal/battery, long recordings. Partial transcripts stay in `status = 'processing'` until complete/cancel/fail.
- Post-processing (title / summary / tags / cards) is **optional UX after** a completed transcript, via existing `runTask` (`passage-summarize`, `smart-tagging`, `learn-this`). Not automatic, not expensive-by-default.
- Tests with fixture audio, timestamps, cancel, permission denied, long audio, airplane mode (on-device still works; Groq does not).

## Capabilities

### New Capabilities

- `apple-speech-transcription`: On-device SpeechAnalyzer/SpeechTranscriber for imported files and live mic notes, generic timestamped transcripts, replacement of silent local→Groq on iOS when Apple speech is available, disclosed Groq fallback, job-queue integration, optional AI enrichment.

### Modified Capabilities

- `transcription-provider-resolution`: `provider` union gains `apple`; native-mobile no longer unconditionally substitutes Groq for `local`.
- `apple-ai-capability-routing`: fills reserved `apple_speech_*` commands; consumes platform capability `apple_speech_transcription` (A registers it; this change does **not** register `on_device_apple_speech`).

## Impact

- **Hard dependency:** `extend-ai-capability-routing-for-apple` (plugin crate, `PermissionDenied` / `UnsupportedLanguage` / `FeatureDisabled` in `src/lib/ai/errors.ts`, fakes, `platformCapabilities.ts` ID slot).
- **Soft dependency:** `add-apple-foundation-models-provider` only for optional post-process tasks; Speech itself does **not** require Apple Intelligence (planning §1.6).
- **Frontend:** `transcriptionProvider.ts`, `transcriptionRouting.ts`, `transcriptionProvider.test.ts`, `AudioTranscriptionSettings.tsx` (stop forcing Groq tab on iOS when Apple is available), `useTranscriptionResolution.ts`, `src/api/transcription.ts`, new `appleSpeech.ts` + fake.
- **Native:** `plugins/plethora-apple-intelligence/ios/Sources/AppleSpeech.swift` (+ tests), plugin `lib.rs` command forwarders, `job_queue.rs` Apple route, `transcription/mod.rs` cancel, `capabilities/default.json` (A may already list the plugin).
- **Privacy:** `scripts/ios-overrides/privacy-manifest.json` microphone purpose string; `docs/release/ios-privacy-manifest-audit.md` camera/mic table.
- **Must NOT:** TTS (`src/api/tts/**`), whisper sidecar behavior on desktop, Groq when the user explicitly selected Groq, automatic `runTask` on every transcript, raising `IPHONEOS_DEPLOYMENT_TARGET` from 14.0.

## Owns

Speech Swift, `appleSpeech.ts`, transcription resolver/routing/settings copy for Apple vs Groq, job_queue Apple backend, mic purpose string, Speech fakes/tests.

## Must NOT change

- `providers/index.ts` routing order (A)
- `EnhancedFilePicker.tsx` import sources (F / vision change)
- `ai_learning/indexer.rs` (C/G)
- Help retrieval
- Android genai Kotlin
