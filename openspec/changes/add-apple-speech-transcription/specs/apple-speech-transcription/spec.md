## ADDED Requirements

### Requirement: Apple Speech capability detection
The system SHALL report SpeechAnalyzer / SpeechTranscriber availability without starting capture, downloading assets, or reading audio contents. Status SHALL be independent of Apple Intelligence / Foundation Models.

#### Scenario: iOS 26 with locale assets installed
- **WHEN** the device is iOS or macOS 26+ and Speech locale assets for the requested language are installed
- **THEN** `apple_speech_status` reports the speech capability as `available`
- **AND** `checkedAt` (or equivalent) is recorded
- **AND** no microphone permission prompt occurs

#### Scenario: Assets downloadable but not installed
- **WHEN** Speech is supported but `AssetInventory` reports locale assets as downloadable
- **THEN** status is `downloadable` with a machine-readable reason
- **AND** checking status does not begin a download

#### Scenario: Unsupported OS or platform
- **WHEN** the OS is below 26, the build is Android/web, or the plugin is the non-Apple stub
- **THEN** status is `unavailable` with reason `platform_unsupported` or `unsupported_os`
- **AND** no Speech framework types are required to compile the non-Apple target

#### Scenario: Microphone permission not determined
- **WHEN** live speech has never been requested
- **THEN** file-transcription availability is still reported independently of mic permission
- **AND** live mode reports mic as `notDetermined` without prompting

### Requirement: Replace silent local-to-Groq substitution on iOS
The system SHALL NOT send audio to Groq when the user asked for local transcription and Apple speech is available. Groq SHALL remain an explicit, disclosed cloud path.

#### Scenario: Native-mobile local with Apple ready
- **WHEN** `resolveTranscription` runs with `provider: "local"`, platform `native-mobile`, and Apple speech status `available`
- **THEN** the successful resolution has `provider: "apple"`
- **AND** it does not set `substitution: "mobile-no-local"`
- **AND** `describeResolution` does not say Groq is being used instead

#### Scenario: Native-mobile local with Apple unavailable and Groq configured
- **WHEN** Apple speech is not available and a Groq API key is present
- **THEN** resolution may use Groq with `substitution: "mobile-no-local"`
- **AND** call sites still invoke `ensureCloudAiDisclosure` with `featureClass: "transcription"` before upload (`src/lib/privacy/cloudAiDisclosure.ts`)

#### Scenario: Native-mobile local with Apple unavailable and Groq missing
- **WHEN** Apple speech is not available and Groq is not configured
- **THEN** resolution is `{ ok: false }` with a typed reason
- **AND** document import, playback, and library navigation still function

#### Scenario: Explicit Groq
- **WHEN** settings `provider` is `"groq"` and a key is present
- **THEN** resolution is Groq regardless of Apple availability
- **AND** disclosure still runs before first cloud transmission

#### Scenario: Desktop local unchanged
- **WHEN** platform is `desktop` and `provider` is `"local"`
- **THEN** resolution still selects whisper/sherpa via installed `ModelProfile`s in `src/lib/transcriptionProvider.ts`
- **AND** Apple is not required

#### Scenario: Explicit apple when unavailable
- **WHEN** settings `provider` is `"apple"` and status is not `available`
- **THEN** resolution does not silently succeed as Groq
- **AND** the UI explains enablement, OS, or asset download using existing error categories (`FeatureDisabled`, `UnsupportedDevice`, `ModelDownloading`, `UnsupportedLanguage`)

### Requirement: Imported audio file transcription
The system SHALL transcribe a user-imported audio file on-device via SpeechAnalyzer when Apple speech is the resolved provider, using `src-tauri/src/transcription/job_queue.rs` as the job orchestrator.

#### Scenario: File job completes
- **WHEN** a library audio document is transcribed with resolved provider `apple`
- **THEN** `JobQueue.process_job` does not run the whisper/sherpa WAV sidecar path
- **AND** generic segments are persisted on `transcript_segments` (`start_ms`, `end_ms`, `text`, `confidence`)
- **AND** events `transcription://status-change`, `transcription://segments-batch`, and `transcription://idle` still fire
- **AND** concatenated text is copied to `documents.content` as today

#### Scenario: Fixture audio timestamps
- **WHEN** a checked-in fixture audio file of known duration is transcribed with the fake or native mapper
- **THEN** each segment has `start_ms <= end_ms`
- **AND** segment starts are non-decreasing
- **AND** the last `end_ms` is within a documented tolerance of the fixture duration

### Requirement: Live lecture and voice note
The system SHALL capture microphone audio for lecture/voice-note modes with the same generic transcript persistence. Lecture vs voice note MAY differ in UX defaults only.

#### Scenario: Live session stop
- **WHEN** the user starts live capture (palette `record-lecture` or equivalent, gated by `apple_speech_transcription`) and then stops
- **THEN** a document and transcript exist with all flushed segments
- **AND** microphone permission was requested at start, not at app launch

#### Scenario: Permission denied
- **WHEN** the user denies microphone permission
- **THEN** live start fails with `PermissionDenied`
- **AND** `apple_speech_start_live` is not retried in a loop
- **AND** file transcription remains eligible if assets are ready

### Requirement: Generic transcript structure for future text-audio navigation
The system SHALL persist Apple results as generic segments and optional measured word timings compatible with `src/api/transcription.ts` `TranscriptSegment` and `src/utils/wordTimings.ts` `WordTiming`. Apple framework types SHALL NOT appear in SQLite or frontend stores.

#### Scenario: Measured words present
- **WHEN** Speech provides word-level `audioTimeRange` data whose token count matches whitespace-split segment text
- **THEN** words are stored with `source: "measured"`
- **AND** karaoke consumers can use them without Apple-specific fields

#### Scenario: Word contract violated
- **WHEN** word count does not equal `text.split(/\s+/).filter(Boolean).length`
- **THEN** the word array is omitted
- **AND** the segment text and times are still stored
- **AND** the UI MAY synthesize approximate timings but MUST NOT persist them as measured

#### Scenario: Segment-only output
- **WHEN** Apple returns segment ranges without words
- **THEN** `transcript_segments` rows are still written
- **AND** no Speech-specific JSON blobs are required for a complete transcript

### Requirement: Reliability, cancel, and partial persist
The system SHALL keep already-emitted segments when work is interrupted, cancelled, or failed, and SHALL never Groq-fallback on cancel.

#### Scenario: User cancel
- **WHEN** `apple_speech_cancel` or `cancel_transcription_job` runs during an Apple job
- **THEN** the error category is `Cancelled`
- **AND** Groq is not invoked
- **AND** persisted partial segments remain queryable

#### Scenario: Incoming call or audio interruption
- **WHEN** an `AVAudioSession` interruption begins during live capture
- **THEN** capture stops
- **AND** flushed segments remain
- **AND** capture does not silently resume during the call

#### Scenario: Backgrounding
- **WHEN** the app is backgrounded during a job
- **THEN** segments already received remain in SQLite
- **AND** v1 does not claim continuous background lecture transcription

#### Scenario: Long or oversized audio
- **WHEN** duration or size exceeds the documented analyzer/app cap
- **THEN** the job fails with `InputTooLarge` (or completes a bounded prefix with a warning — pick one in implementation and test it)
- **AND** the host document still exists
- **AND** any accepted prefix segments are persisted

#### Scenario: Airplane mode on-device
- **WHEN** the network is unavailable and Apple locale assets are already installed
- **THEN** Apple file/live transcription can still complete
- **AND** Groq transcription does not succeed

#### Scenario: Battery or thermal resource error
- **WHEN** the native layer reports a recoverable resource/busy error
- **THEN** partials are kept
- **AND** the user can retry
- **AND** automatic Groq fallback does not run unless they selected Groq

### Requirement: Optional AI post-processing
The system SHALL NOT automatically run expensive title/summary/tag/card generation on every transcript. Optional actions SHALL use existing `runTask` definitions with untrusted containment.

#### Scenario: User requests summary after complete
- **WHEN** transcript status is `completed` and the user invokes summarize
- **THEN** `passage-summarize` (or equivalent existing task) runs on `documents.content` wrapped as untrusted source
- **AND** no new Apple-only summarize API is introduced

#### Scenario: Default completion
- **WHEN** a lecture or file job completes
- **THEN** no `learn-this` / Studio / smart-tagging job starts unless the user already enabled a global import-time setting that applies to all documents

### Requirement: Core app never depends on STT success
Transcription failure SHALL NOT block importing or opening audio documents.

#### Scenario: STT unavailable at import
- **WHEN** the user imports an audio file and no transcription provider can run
- **THEN** the document is still in the library
- **AND** the user sees a resolution failure via existing `showTranscriptionResolutionFailure` / settings copy rather than a crash
