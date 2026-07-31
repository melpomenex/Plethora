## ADDED Requirements

### Requirement: Inference runs off the main thread natively

Native on-device ONNX inference SHALL execute on a background thread inside the Kotlin plugin. The main (UI) thread SHALL never run a generation step or block on synthesis, so that the reader continues to scroll and respond during playback without an ANR.

#### Scenario: No ANR during synthesis

- **WHEN** a long synthesis and playback is in progress
- **THEN** the reader continues to scroll and respond to input, and Android does not raise an Application Not Responding dialog

#### Scenario: UI thread never blocks on inference

- **WHEN** the plugin receives a speak request
- **THEN** generation is dispatched to a background thread and the IPC handler returns immediately

### Requirement: sherpa-onnx is the shared inference runtime

The plugin SHALL integrate sherpa-onnx (`com.github.k2-fsa:sherpa-onnx`) as the native inference runtime, consuming its `OfflineTts` API with the model-config types for KittenTTS (`OfflineTtsKittenModelConfig`) and Kokoro-82M (`OfflineTtsKokoroModelConfig`). The plugin SHALL NOT run ONNX inference in the webview.

#### Scenario: KittenTTS uses the Kitten config

- **WHEN** KittenTTS Micro is the active model
- **THEN** the plugin constructs an `OfflineTtsKittenModelConfig` and initializes sherpa-onnx with it

#### Scenario: Kokoro uses the Kokoro config

- **WHEN** Kokoro-82M is the active model
- **THEN** the plugin constructs an `OfflineTtsKokoroModelConfig` and initializes sherpa-onnx with it

### Requirement: PCM streams directly into AudioTrack, never through Tauri IPC

The plugin SHALL stream callback PCM from sherpa-onnx directly into an Android `AudioTrack` (`MODE_STREAM`, `ENCODING_PCM_FLOAT`). PCM SHALL NOT be transferred to the webview or across the Tauri IPC boundary, which is JSON-only on Android.

#### Scenario: Callback PCM reaches AudioTrack

- **WHEN** sherpa-onnx invokes the generation callback with a float PCM chunk
- **THEN** the plugin writes that chunk to the active `AudioTrack` and the webview receives no audio bytes

#### Scenario: Correct sample rate

- **WHEN** an `AudioTrack` is constructed for a model
- **THEN** its sample rate matches the value reported by the model's runtime (`OfflineTts.sampleRate()`), rather than a hardcoded constant

### Requirement: Play, pause, resume, and stop

The plugin SHALL expose play, pause, resume, and stop controls over native playback and SHALL reflect their effects to the webview through playback-state events.

#### Scenario: Pause and resume

- **WHEN** the user pauses during playback and later resumes
- **THEN** audio pauses at the current position and resumes from there without restarting the utterance

#### Scenario: Stop cancels promptly

- **WHEN** the user stops during playback or synthesis
- **THEN** generation and playback stop promptly, in-flight PCM is discarded, and the engine returns to idle within a bounded interval

### Requirement: Single-engine ownership prevents concurrent playback

The plugin SHALL prevent two engines (sherpa-onnx and the System-TTS fallback, or two overlapping speak calls) from producing audio simultaneously.

#### Scenario: New speak supersedes the in-flight one

- **WHEN** a new speak request arrives while one is in flight
- **THEN** the in-flight request is cancelled and only the newer request's audio is produced

#### Scenario: Fallback never overlaps native synthesis

- **WHEN** native synthesis fails mid-utterance and the fallback is engaged for the same utterance
- **THEN** the native engine is stopped before the fallback begins, so the two never speak at once

### Requirement: Audio focus and interruption handling

The plugin SHALL request audio focus before playing, SHALL react to focus loss, and SHALL handle interruptions (calls, other media) so that TTS behaves correctly alongside other audio.

#### Scenario: Focus requested before playback

- **WHEN** playback is about to start
- **THEN** the plugin requests audio focus before writing any PCM

#### Scenario: Transitory focus loss pauses playback

- **WHEN** another app transiently takes audio focus
- **THEN** playback pauses and resumes when focus returns

#### Scenario: Permanent focus loss stops playback

- **WHEN** another app permanently takes audio focus
- **THEN** playback stops and the engine returns to idle

#### Scenario: Focus abandoned on stop

- **WHEN** playback stops or the plugin is torn down
- **THEN** the plugin abandons audio focus

### Requirement: Lifecycle cleanup

The plugin SHALL manage native resources across the activity lifecycle: releasing `AudioTrack`, releasing sherpa-onnx sessions, and abandoning audio focus on pause, stop, destroy, and memory pressure.

#### Scenario: Resources released on background

- **WHEN** the app is backgrounded (`onStop`)
- **THEN** audio focus is abandoned and the `AudioTrack` is paused or released, and the next speak re-acquires them

#### Scenario: Sessions released under memory pressure

- **WHEN** the platform signals memory pressure (`onLowMemory` / `onTrimMemory`)
- **THEN** sherpa-onnx sessions are released and any in-flight synthesis is cancelled with a recoverable error

#### Scenario: Clean teardown on destroy

- **WHEN** the plugin or activity is destroyed
- **THEN** the `AudioTrack` is released, audio focus is abandoned, and no native resources leak

### Requirement: Background and locked-screen playback where supported

Where the platform supports it, the plugin SHALL keep playback running when the screen is locked or the app is backgrounded, using a foreground service so the OS does not kill audio playback.

#### Scenario: Playback continues with screen locked

- **WHEN** the screen locks during playback (and the platform supports it)
- **THEN** audio continues without interruption

### Requirement: System-TTS fallback when no model is installed or inference fails

The plugin SHALL keep reading audible by falling back to the Android platform `TextToSpeech` engine whenever native inference cannot run.

#### Scenario: No model installed

- **WHEN** the user speaks with no local model installed
- **THEN** the utterance is spoken by Android `TextToSpeech`

#### Scenario: Model fails to load

- **WHEN** the active model's files are missing or corrupt and fail to load
- **THEN** the utterance falls back to `TextToSpeech` and a non-blocking notice is surfaced

#### Scenario: Inference fails mid-utterance

- **WHEN** native synthesis errors after playback has begun
- **THEN** the fallback engine finishes the current utterance, and the native engine is stopped first to avoid overlap

#### Scenario: Distinct from the webview System TTS provider

- **WHEN** the native fallback is engaged
- **THEN** it is the Android platform `TextToSpeech`, not the webview `SpeechSynthesis` provider, and only one is active at a time

### Requirement: Event streaming to the webview

The plugin SHALL emit small JSON events to the webview for download progress, playback state, errors, utterance completion, and sentence position. No audio bytes SHALL be included in any event.

#### Scenario: Playback-state events

- **WHEN** playback starts, pauses, resumes, or stops
- **THEN** the plugin emits a playback-state event reflecting the new state

#### Scenario: Sentence-position events

- **WHEN** a new sentence begins playing
- **THEN** the plugin emits a sentence-position event identifying the active sentence, so the reader can highlight it

#### Scenario: Utterance completion

- **WHEN** the sentence queue drains
- **THEN** the plugin emits an utterance-completion event

#### Scenario: Errors surfaced, not swallowed

- **WHEN** synthesis, playback, or asset handling fails
- **THEN** the plugin emits an error event with a machine-readable kind and a human-readable message

### Requirement: Sentence chunking with prefetching

The plugin SHALL play audio sentence-by-sentence with prefetching, so that playback starts after the first sentence rather than after the whole passage synthesizes.

#### Scenario: First sentence plays before the whole passage synthesizes

- **WHEN** a multi-sentence passage is spoken
- **THEN** playback begins once the first sentence is synthesized, while later sentences are synthesized concurrently

#### Scenario: Prefetch keeps playback continuous

- **WHEN** sentence N is playing
- **THEN** sentence N+1 is being or has been synthesized on the background thread, so gaps between sentences are minimized
