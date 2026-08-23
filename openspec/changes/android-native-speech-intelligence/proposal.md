## Why

Lectures and imported audio should become ordinary Plethora transcript documents without requiring a cloud STT key when Android on-device speech is available. ML Kit GenAI Speech Recognition (alpha) offers Basic (API 31+, per-locale models) and Advanced (Pixel 10 Nano). Plethora already has whisper/sherpa/Groq — this is another **SpeechProvider**, not a parallel product.

## Existing behavior

- Rust transcription queue, segment events, `word_timings_json` optional, karaoke helpers.
- HF speech model manager OpenSpec for whisper/sherpa installs.
- No ML Kit Speech.

## What Changes

- Plugin `plethora-android-speech` wrapping `com.google.mlkit:genai-speech-recognition:1.0.0-alpha1` (re-pin at implement time).
- Implement A’s `transcribeAudio` / `transcribeLiveAudio`.
- Chain (default when user has not pinned an engine): Advanced if ready → Basic if ready → existing local STT → cloud STT if policy allows. **Explicit user STT choice always wins.**
- File input: API requires **raw 16-bit PCM mono 16 kHz** — convert in-plugin or Rust; do not pretend arbitrary m4a works.
- Persist: (1) audio file in existing media storage **first**, (2) finalized segments incrementally, (3) never delete audio because post-process failed.
- Timestamps: segments as delivered; **do not invent word timings**. Partial vs final per API (`PartialTextResponse` / `FinalTextResponse`).
- Treat inference as **foregroundOnly** until proven otherwise. Recording may use a microphone foreground service; transcription pauses when GenAI blocks background.
- Permissions: `RECORD_AUDIO` contextual for live; not requested at app start.

## Capabilities

### New Capabilities
- `android-speech-intelligence`: live/file transcription, PCM conversion, persistence, fallback chain, lecture workflow.

## Non-goals

- Speaker diarization unless the API actually returns it (not documented).
- Replacing whisper on desktop.

## Dependencies

A (interfaces). Respect `huggingface-speech-model-manager` / existing engine picker.

## Expected ownership

**Agent E.** Does not own Gemini Prompt or card UI.
