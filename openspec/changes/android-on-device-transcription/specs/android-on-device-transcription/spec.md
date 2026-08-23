## ADDED Requirements

### Requirement: On-device STT engine for imported media on Android
The system SHALL provide an on-device speech-to-text engine on Android, backed by sherpa-onnx OfflineRecognizer, supporting the SenseVoice-small int8 model (multilingual default) and the Parakeet int8 model (English fast path), for transcribing imported audiobook and podcast audio without network access or API keys.

#### Scenario: Engine transcribes an imported audiobook on device
- **WHEN** an Android user triggers transcription of an imported audiobook with the on-device engine enabled and a model downloaded
- **THEN** the audio is transcribed entirely on device with no outbound network requests and no API key required

#### Scenario: Engine unavailable off-Android
- **WHEN** any on-device STT plugin command is invoked on a non-Android platform
- **THEN** the command rejects with a `platform_unsupported` error and no transcription state changes

### Requirement: Streaming container decode to engine PCM
The system SHALL decode imported audio containers (MP3, M4B, M4A, Opus in supported containers, WAV) to 16 kHz mono PCM16LE via Android MediaCodec, streaming from the source file on disk in bounded-memory chunks. The system MUST NOT load whole files or whole-book PCM into memory or pass audio as base64 over the Tauri IPC bridge.

#### Scenario: Long audiobook decodes within bounded memory
- **WHEN** an 8-hour M4B audiobook is transcribed on a device with modest RAM
- **THEN** decoding streams chunk-by-chunk from disk and peak memory stays bounded by chunk size rather than file duration

#### Scenario: Unsupported container is rejected with a typed error
- **WHEN** a file with a container or codec MediaCodec cannot decode is submitted
- **THEN** the job fails with a `codec_unsupported` error identifying the file, and previously checkpointed segments for that document are preserved

### Requirement: Timed segments with word timestamps
The engine SHALL produce timed transcript segments by rolling word-level timestamps from the recognizer up into segments, and SHALL persist them to the existing `transcripts` / `transcript_segments` tables (keyed `book_id = chapter_id = document_id`) with combined full text written to `documents.content`, matching the schema the Groq path produces.

#### Scenario: Segments carry timings usable by the player
- **WHEN** an on-device transcription job completes for a document
- **THEN** stored segments have `start_ms` / `end_ms` / `text` values that the audiobook player can use for transcript sync and seek

#### Scenario: Transcript visible to assistant and search
- **WHEN** an on-device transcription job completes
- **THEN** the combined text is stored on the document such that the AI assistant, search, and section indexing treat it identically to a Groq-produced transcript

### Requirement: Chunked processing with checkpoint and resume
The system SHALL process audio in chunks (VAD-segmented where the model benefits) and persist each chunk's segments plus a decode-position checkpoint as they complete. On interruption (app kill, cancellation, thermal pause), the system SHALL resume from the checkpoint on retry without re-decoding or re-inferring completed chunks, and existing segments MUST survive an interrupted run.

#### Scenario: Interrupted job resumes without redoing work
- **WHEN** a transcription job is interrupted mid-book and later retried
- **THEN** processing resumes from the last checkpoint and already-completed segments remain in the transcript

#### Scenario: Cancelled job keeps completed segments
- **WHEN** the user cancels an in-progress on-device transcription
- **THEN** the transcript status is marked cancelled with all completed segments preserved

### Requirement: On-device model management
The system SHALL provide download, delete, and status operations for the supported STT models on Android, storing model files in app-private storage, and SHALL surface model status (not-downloaded / downloading with progress / ready) in the On-Device AI settings panel. Model downloads SHALL be resumable and verified (size/checksum) before being marked ready.

#### Scenario: First-run user downloads the default model
- **WHEN** an Android user enables on-device transcription without a model present and taps download in the On-Device AI panel
- **THEN** the model downloads with visible progress and becomes selectable once verified

#### Scenario: Interrupted download resumes
- **WHEN** a model download is interrupted partway
- **THEN** retrying the download resumes from the partial data rather than restarting, and the model is never marked ready before verification passes

### Requirement: Foreground service with thermal pacing
On-device transcription jobs SHALL run inside an Android foreground service (media-processing type where available) with a visible notification and progress, and SHALL expose a pacing mode that caps worker threads (default: capped) to limit heat; the pacing preference SHALL be user-configurable (Capped / Full speed).

#### Scenario: Transcription survives backgrounding
- **WHEN** the user backgrounds the app or locks the screen during an on-device transcription job
- **THEN** the foreground service keeps processing and progress events continue on `audiobook://transcription-progress`

#### Scenario: Capped pacing reduces concurrency
- **WHEN** pacing is set to Capped (default) on a multi-core device
- **THEN** the engine uses a reduced thread count chosen to keep sustained power draw low, at the cost of longer wall-clock time

### Requirement: Import-flow routing with Groq fallback
On Android, audiobook and podcast import transcription SHALL route to the on-device engine when enabled (default when a model is ready), and the system SHALL offer Groq cloud transcription as an explicit per-job or settings override, including automatic fallback when the on-device engine is unavailable (no model, decode failure, low storage). On other platforms, routing behavior SHALL be unchanged.

#### Scenario: Default routing picks on-device on Android
- **WHEN** an Android user with a ready model imports an audiobook and accepts transcription
- **THEN** the job runs on device and no Groq API key is required

#### Scenario: Explicit Groq override
- **WHEN** the user selects Groq for a transcription job or in settings on Android
- **THEN** the job uses the existing cloud path exactly as before this change

#### Scenario: Fallback on engine unavailability
- **WHEN** the on-device engine is enabled but cannot run (model deleted, decode error, insufficient storage) and a Groq key is configured
- **THEN** the job falls back to Groq with a user-visible notice instead of silently failing

### Requirement: Progress reporting parity
On-device jobs SHALL emit progress on the existing `audiobook://transcription-progress` event channel (keyed by documentId) with status, percent, and message compatible with current listeners, and the transcription queue UI SHALL display on-device jobs like any other job.

#### Scenario: Queue shows on-device job progress
- **WHEN** an on-device transcription job is running
- **THEN** the existing transcription queue and audiobook progress surfaces show its status and percentage
