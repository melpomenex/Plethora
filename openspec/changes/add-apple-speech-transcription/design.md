## Context

Desktop STT already exists: whisper.cpp / sherpa via Hugging Face, orchestrated by `src-tauri/src/transcription/job_queue.rs`. The queue is single-consumer: `enqueue` → `process_job` (status `processing`, prepare WAV, `transcribe_route`, batched `transcript_segments` inserts, `transcription://segments-batch`, copy concatenated text onto `documents.content`, cleanup WAV).

Cloud STT is Groq Whisper (`src/api/groqTranscription.ts`) gated by `ensureCloudAiDisclosure({ featureClass: "transcription", provider })`.

**The bug this change exists to kill:**

```ts
// src/lib/transcriptionProvider.ts
const mobileSubstitution =
  platform === "native-mobile" && audioSettings.provider === "local";
const provider = mobileSubstitution ? "groq" : audioSettings.provider;
```

`AudioTranscriptionSettings.tsx` currently forces the Groq tab on `isNativeMobile()` and documents that local whisper is desktop-only. That remains true for **whisper sidecars**. Apple Speech is the on-device mobile replacement.

Binding decisions (planning `openspec/planning/ios-on-device-ai-openspecs.md`): D-Apple-1, D-Apple-2, D-Apple-11, D-Apple-13, D-Apple-14. SpeechAnalyzer does **not** require Apple Intelligence. Min compile target stays iOS 14; all Speech 26 APIs are `@available`.

Constraints:

- One heavy SpeechAnalyzer **or** FM **or** Vision batch in flight (D-Apple-14). Reuse Android `requestId` + event channel pattern.
- Cancelled work never cloud-falls-back (`src/lib/ai/errors.ts` `Cancelled`).
- Diagnostics: no transcript text, prompts, or audio.
- Simulator: Speech assets often missing — fake provider is mandatory in CI (Vitest + Rust unit tests). Physical-device / TestFlight is manual.

## Goals / Non-Goals

**Goals:**

- On-device file transcription and live lecture/voice-note transcription on iOS/macOS 26+ when locale assets are ready.
- Replace silent local→Groq substitution when Apple speech is available; keep Groq as an explicit, disclosed cloud path.
- Persist **generic** timestamped transcripts (segments + optional measured words) so karaoke / extracts-while-listening / future text↔audio nav can consume Apple output the same way they consume Groq/`WordTiming`.
- Survive interruptions, calls, backgrounding, denials, cancel, battery pressure, and large files without losing already-emitted segments.
- Optional post-process via existing AI tasks only when the user asks.

**Non-Goals:**

- TTS, diarization productization (settings flag `speakerDiarization` exists; do not invent an Apple-only speaker graph in v1 unless Speech documents a stable generic mapping).
- Running whisper.cpp on iOS.
- Automatic title/summary/tags/cards on every completed job.
- watchOS, raising deployment target, Private Cloud Compute.
- A second TypeScript job framework.

## Decisions

### 1. Resolver policy (replaces silent substitution)

Extend settings and `TranscriptionAudioSettings.provider` to `"local" | "groq" | "apple"`.

`resolveTranscription(settings, profiles, platform, appleStatus)`:

| User setting | Apple speech ready (iOS/macOS 26+) | Result |
|---|---|---|
| `apple` | yes | `{ ok, provider: "apple", modelId: "speech-transcriber", … }` |
| `apple` | no | do not pretend; see fallback row |
| `local` on native-mobile | yes | `{ ok, provider: "apple", substitution?: "mobile-apple-speech" }` — **not** Groq |
| `local` on native-mobile | no | if Groq key + user has not blocked cloud: `{ groq, substitution: "mobile-no-local" }` **with copy that names Groq**; else `{ ok: false, reason: "apple-unavailable" \| "missing-groq-key" }` |
| `local` on desktop | n/a | existing whisper/sherpa resolution (unchanged) |
| `groq` | any | Groq iff key present; always disclosed at call site |

Never fail the rest of the app: import, playback, and library continue if STT cannot run. Show `describeResolution` / `showTranscriptionResolutionFailure` instead of throwing in the picker.

`substitution: "mobile-no-local"` remains only for the **true** "no on-device engine" case so existing tests in `src/lib/__tests__/transcriptionProvider.test.ts` can be updated rather than deleted: when Apple **is** ready, that substitution must not fire.

### 2. Generic transcript DTO (not Apple types)

IPC and SQLite speak only:

```ts
// Align with src/api/transcription.ts TranscriptSegment
// and src/utils/wordTimings.ts WordTiming
interface GenericTranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number; // 0–1; use 0 if Apple omits
  words?: Array<{
    word: string;
    start_ms: number;
    end_ms: number;
    source: "measured"; // never "synthesized" from Apple
  }>;
}
```

Map `audioTimeRange` (seconds) → ms with integer rounding that preserves order (`start_ms <= end_ms`, monotonic starts). If Apple provides segment ranges but not words, omit `words` and let UI synthesize via `synthesizeWordTimings` (already marked approximate — do not persist synthesized words).

Word arrays MUST satisfy `text.split(/\s+/).filter(Boolean).length === words.length` when present (`wordTimings.ts` contract). If they do not, drop `words` rather than lie.

`transcripts.model_used` stores a stable id such as `apple-speech-transcriber` plus locale, never a Swift class name.

Optional JSON column or sidecar table for words: prefer extending persistence only if `transcript_segments` cannot hold words today (it cannot — five columns). Add a nullable `words_json TEXT` on `transcript_segments` **or** a child `transcript_words` table in a new migration. Do not overload `text` with markup.

### 3. Plugin commands (fill A's reserved namespace)

Swift file: `src-tauri/plugins/plethora-apple-intelligence/ios/Sources/AppleSpeech.swift`.

| Command | Role |
|---|---|
| `apple_speech_status` | No side effects. OS version, `@available`, locale, `AssetInventory` installed/downloadable, mic permission enum, `busy` if analyzer in flight. |
| `apple_speech_ensure_assets` | User-initiated locale asset download; progress events; never implicit on status. |
| `apple_speech_transcribe_file` | File URL in app sandbox / security-scoped; `requestId`; streams segment events. |
| `apple_speech_start_live` | Mic session; lecture vs voice-note is a **UI mode**, same engine. |
| `apple_speech_stop_live` | Finalize, flush remaining segments, persist. |
| `apple_speech_cancel` | Abort `requestId`; emit `Cancelled`; keep persisted partials. |

Non-Apple OS: every command → `platform_unsupported` (existing plugin stub pattern from `plethora-android-genai/src/lib.rs`).

TS: `src/lib/ai/appleSpeech.ts` wraps invoke + event channel. React must not call Speech APIs.

### 4. Job queue integration

Do **not** spawn a second queue. In `job_queue.rs` `process_job`, after language/model routing (`stt_route_for_model`), if `model_id` is the Apple sentinel (or a new `TranscriptionJob.backend: Apple` field):

- Skip `engine.prepare_audio` WAV/whisper path (no FFmpeg sidecar on iOS).
- Forward the original `audio_path` to `apple_speech_transcribe_file`.
- Reuse `spawn_segment_consumer` / `flush_segment_batch` so UI (`useTranscriptionStore.ts`) keeps working.

Live notes: create a `documents` row (audio file in app storage) + `transcripts` row up front, stream segments the same way. On stop, mark `completed` and copy full text to `documents.content` (same as job_queue steps 5–6).

Cancel: `transcription::cancel_transcription_job` must call `apple_speech_cancel` when the active job is Apple.

### 5. Live lecture / interruptions

- Request microphone **at the start of live recording**, not at launch (`complete-ios-apple-privacy-compliance` contextual permissions).
- Purpose string (privacy-manifest.json) must mention lecture/voice notes and that audio stays on device unless the user chooses cloud transcription.
- Audio session: play-and-record / spoken-audio appropriate for lectures; duck or pause on interruption (`AVAudioSession.interruptionNotification`, phone calls).
- On interruption: **stop capturing**, flush partials, set status `processing` or a dedicated `paused` if we add it; never delete segments. Resume only on explicit user action (do not silently resume in a call).
- Backgrounding: iOS will suspend; persist everything already received. Do not claim "background lecture transcription" unless we add a documented background-audio mode in a later change — v1 is foreground + interruption-safe.
- Battery/thermal: if Speech or the OS reports a recoverable resource error, map to `GenerationFailed` / `CapabilityUnavailable`, keep partials, do not Groq-fallback unless the user retries with Groq selected.
- Large files: reject or chunk by documented analyzer limits; surface `InputTooLarge`; still keep the document.

### 6. Fallback and airplane mode

Airplane mode: Apple path **must still succeed** if assets are already on device. Groq must fail closed with `ProviderOffline` / existing network error, never as a silent retry.

If Apple assets are `downloadable`, status says so; transcribe-file does not start a surprise download (mirror Nano: user initiates `ensure_assets`).

Core app: document import of mp3/m4a still works if STT fails.

### 7. Optional AI enrichment

After `status = 'completed'`, UI may offer "Summarize", "Suggest tags", "Generate cards" using `runTask` on `documents.content` wrapped in `<untrusted_source>` (`containment.ts`). Default off. No automatic Studio/learn-this on lecture end.

### 8. Errors

Map into categories A adds/extends:

| Native | Category |
|---|---|
| Mic denied | `PermissionDenied` |
| Locale not in Speech language set | `UnsupportedLanguage` |
| OS < 26 or analyzer missing | `UnsupportedDevice` / `FeatureDisabled` |
| Assets downloading | `ModelDownloading` |
| User cancel | `Cancelled` (no Groq) |
| Analyzer failure | `GenerationFailed` |

Do not leak audio paths with user folder names into diagnostics.

### 9. Testing

- Vitest: resolver matrix (Apple ready/unready × local/groq/apple × desktop/mobile), `describeResolution` copy, cancel vs fallback, fake `appleSpeech` streaming events, word-count contract.
- Rust: job_queue Apple route does not call whisper prepare_audio; segment batch still FIFO; cancel.
- Swift (where CI allows) or extracted pure mappers: `audioTimeRange` → ms; interruption state machine.
- Fixtures: short WAV/m4a in `src/lib/ai/__fixtures__/speech/` (checked-in, licensed); long-audio test uses a generated silent/tone buffer of known duration rather than a huge binary.
- Permission denied: fake status `denied` → UI + resolver, no plugin transcribe call.
- Airplane: mock network offline; Apple fake still completes; Groq path does not.

Manual / TestFlight: live lecture, incoming call, lock screen, locale asset download.

## Risks

- Editing `job_queue.rs` can regress desktop whisper batching — gate Apple behind backend enum, keep WAV path intact.
- `AudioTranscriptionSettings.tsx` Groq-tab force will hide Apple if not updated.
- Unbounded live sessions (memory): cap duration or roll files; persist incrementally.
- iOS 14 compile: unguarded Speech 26 types break the Xcode target.
- Merge conflict with A on plugin `lib.rs` command list — add modules only.
