# Design: Android native speech

## Native APIs

https://developers.google.com/ml-kit/genai/speech-recognition/android

- Artifact: `com.google.mlkit:genai-speech-recognition:1.0.0-alpha1` (**alpha**).
- Basic: API 31+; locales listed in docs (en-US GA, many beta).
- Advanced: Pixel 10; broader locales; small adapter vs 100–200 MB per Basic locale.
- Sources: `AudioSource.fromMic()`, `fromPfd` PCM only.
- Responses: Partial, Final, Completed, Error — **no word timestamps in reference**.

## Architecture

```text
Record Lecture → disk writer (survives crashes)
              → SpeechProvider.startLive() if foreground/ready
              → append Final segments to transcript document draft
              → on interrupt: keep audio + finalized segments; mark incomplete
```

Imported audio: transcode → transcribe file → existing transcript document pipeline.

Voice note: short recording → note/extract using existing document types.

## UX

Palette: “Record lecture”, “Transcribe audio”. Progress, cancel, permission rationale. TalkBack labels. After save, optional B enrichment is **user-requested**.

## Privacy

On-device for ML Kit path. No transcript logging. Mic permission contextual.

## Background

If `BACKGROUND_USE_BLOCKED` during transcribe: pause recognizer, **keep recording** if the capture path is a non-GenAI recorder; surface `ForegroundRequired` for the transcribe job.

## Fallback / errors

Map into A’s taxonomy + `PermissionDenied`. Unsupported codec → `InvalidInput` after conversion attempt.

## Tests

FakeSpeechProvider. Kotlin tests for PCM rejection. Do not CI-assert Nano transcripts. Device matrix: API 31 emulator Basic if possible; Pixel 10 Advanced manual; permission denied; long recording crash recovery.

## Security

Validate duration/size; no arbitrary file URIs outside picked audio; session ids for cancel.
