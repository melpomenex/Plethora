## Why

On Android, imported audiobooks and podcasts can only be transcribed through Groq's cloud API: `transcribe_audio_file_groq` / `transcribe_podcast_groq_chunks` are hardcoded into the import flows, require a user-supplied API key, and upload hours of audio off-device. The on-device ML Kit engine is lecture-capture-only (single untimed segment, AICore-gated), and the desktop Sherpa STT engine runs via sidecar binaries that are not shipped in the Android build. Android users with local libraries get no private, offline, key-free transcription path.

## What Changes

- Add an on-device Android STT engine backed by sherpa-onnx (the same pinned `com.github.k2-fsa:sherpa-onnx:1.13.4` AAR the TTS plugin already ships) running **SenseVoice-small int8** (multilingual default) and **Parakeet int8** (English fast path) models.
- Add a MediaCodec decode pipeline that streams any imported container (MP3/M4B/M4A/opus) from disk as 16 kHz mono PCM16LE — no whole-file base64 over IPC; chunked decoding with VAD segmentation.
- Produce **timed segments** (word timestamps rolled up to segments) written to the existing `transcripts` / `transcript_segments` tables with checkpoint-per-chunk, so throttling, pause, or app kills resume instead of restarting.
- Add on-device model download/management for Android (reuse the HF model-manager patterns; surface status in the On-Device AI settings panel).
- Route Android audiobook and podcast import transcription to the on-device engine when enabled; Groq remains available as an explicit fallback/override. ML Kit lecture capture is unchanged.
- Run transcription in a foreground service with a thermal-friendly pacing mode (thread capping) and progress events on the existing `audiobook://transcription-progress` channel.

## Capabilities

### New Capabilities
- `android-on-device-transcription`: On-device transcription of imported audiobooks and podcasts on Android — decode pipeline, sherpa-onnx engine (SenseVoice/Parakeet), timed segment output with checkpointing, model management, foreground-service execution with pacing, and import-flow routing with Groq fallback.

### Modified Capabilities
<!-- None: no existing spec covers media transcription routing; the desktop queue and ML Kit lecture capture behaviors are unchanged. -->

## Impact

- **New Tauri plugin** `src-tauri/plugins/plethora-android-stt/` (Rust shim + Kotlin: MediaCodec decoder, sherpa-onnx wrapper, foreground service). ML Kit stays in `plethora-android-speech` untouched.
- **Rust**: new `transcribe_audio_file_on_device` command (mirrors `transcribe_audio_file_groq` in `src-tauri/src/commands/podcast.rs`), plugin registration in `lib.rs`, capability permissions for the new plugin commands.
- **Frontend**: AudiobookViewer / podcast import routing picks on-device engine on Android; settings additions (`audioTranscription.provider` gains an `"android-ondevice"` option plus model + pacing preferences); On-Device AI panel model status/download UI; i18n strings in all 6 locales.
- **Dependencies**: no new Gradle dependencies (sherpa-onnx AAR already pinned at 1.13.4 in the TTS plugin); STT model files (~100–250 MB each) downloaded on demand to app storage.
- **Out of scope**: iOS (Apple path exists), desktop queue changes, diarization, NPU/QNN builds.
