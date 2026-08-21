## Purpose

Defines how Plethora executes local sherpa-onnx text-to-speech natively on every
supported platform (Android, Linux, macOS, Windows) for HF-installed models — starting
with the Supertonic 3 family — behind one shared user-facing provider, playback
surface, and resource lifecycle.

## ADDED Requirements

### Requirement: Cross-platform local execution of sherpa TTS families
The system SHALL execute installed sherpa-onnx TTS models natively on Android, Linux
x86-64, macOS (Apple Silicon and x86_64), and Windows x86-64 using the platform's
native sherpa-onnx integration (JNI/Kotlin on Android; the sherpa-onnx C API loaded
in-process on desktop). The same logical model ID, family metadata, voice roster,
speed handling, and synthesis semantics SHALL apply on every platform even though the
native bridge differs. A normal Plethora build SHALL NOT require users to install
Python, ONNX Runtime, sherpa CLI tools, or any system package to use a downloaded
model, and SHALL NOT synthesize through a WebView/WASM runtime.

#### Scenario: Same model runs on every platform
- **WHEN** the canonical Supertonic model is installed on an Android device, a Linux
  desktop, a macOS Apple Silicon desktop, and a Windows desktop
- **THEN** each platform SHALL be able to select the same model ID as the active TTS
  model and synthesize speech offline with its native runtime

#### Scenario: No external runtime dependencies
- **WHEN** a fresh Plethora install selects an installed local TTS model
- **THEN** synthesis SHALL work without any user-installed interpreter, service, or
  system library beyond what the app ships

### Requirement: Desktop native sherpa TTS engine
Desktop builds SHALL provide a native TTS engine that loads an installed model
directory plus its run contract, keeps the engine session loaded across utterances,
reports the engine's actual sample rate and speaker count, synthesizes a requested
sentence at a requested speed and voice index, supports prompt cancellation of an
in-flight synthesis, and explicitly unloads the session on demand. Engine work SHALL
run off the UI thread. If the native runtime is unavailable in a build, the system
SHALL report that clearly rather than offering models it cannot run.

#### Scenario: Synthesize and play offline
- **WHEN** the user reads a sentence with an installed Supertonic model on desktop
- **THEN** the engine synthesizes audio locally, returns PCM/WAV tagged with the
  engine-reported sample rate, and playback proceeds with no network access

#### Scenario: Cancellation aborts promptly
- **WHEN** the user stops or skips while a sentence is synthesizing
- **THEN** generation is aborted promptly, partial audio is discarded, and no orphaned
  native resources remain

#### Scenario: Session reuse without reload churn
- **WHEN** consecutive sentences are synthesized from the same model
- **THEN** the engine session is reused (no per-sentence model reload) until the model
  or provider changes

### Requirement: Android consumes HF-installed models without duplication
The Android TTS plugin SHALL accept HF-installed model IDs, resolve them against the
shared HF installation registry, and load the model from the single managed install
directory rather than maintaining a second copy of the weights. The plugin SHALL
construct the family-appropriate sherpa configuration (including the Supertonic
multi-model pipeline) and SHALL preserve existing Kitten and Kokoro download, load,
and playback behavior unchanged.

#### Scenario: HF-installed Supertonic plays natively
- **WHEN** a Supertonic model is installed through the Hugging Face manager on Android
  and selected as the active model
- **THEN** the plugin loads it from the HF install directory, streams synthesized PCM
  to native audio output off the UI thread, and emits sentence-position and completion
  events

#### Scenario: Existing catalogs unaffected
- **WHEN** the user uses the pinned Kitten or Kokoro models after the update
- **THEN** their download, selection, and playback behave exactly as before

### Requirement: Single shared local TTS provider surface
Supertonic-capable local models SHALL be exposed through ONE provider identity shared
by all platforms. The provider's model list SHALL be derived from installed HF models
of the matching runtime and family; selecting a model persists a preference keyed by
the shared logical model ID; installation state remains device-local. When a selected
model is not installed on the current device, the UI SHALL show a clear
"download required" state and SHALL NOT silently fall back to another provider.

#### Scenario: No duplicate providers
- **WHEN** the user opens TTS settings on desktop and on Android
- **THEN** both show the same single local Supertonic provider entry, not separate
  per-platform providers

#### Scenario: Missing device-local installation handled gracefully
- **WHEN** a synced preference selects Supertonic on a device where it is not
  installed
- **THEN** the UI shows that the model must be downloaded locally and offers the
  install path, without errors, duplicate entries, or cloud fallback

### Requirement: Voice and speed semantics
The provider SHALL expose the voice/style roster reported by the engine or stored in
the model's metadata (sid-indexed), defaulting to the first packaged style, and SHALL
apply the reader rate as the synthesis speed parameter. Voice metadata SHALL be
extensible to additional Supertonic style assets without changing the provider
contract. Word-level timestamps SHALL NOT be fabricated when the engine does not
provide them.

#### Scenario: Packaged voices listed
- **WHEN** an installed Supertonic model reports its speaker count
- **THEN** the voice picker lists exactly those styles with a stable default

#### Scenario: Rate adjustment applies
- **WHEN** the user changes reading speed during or before playback
- **THEN** subsequent synthesis reflects the requested speed

### Requirement: Playback integrates with the existing reading experience
Local sherpa TTS SHALL participate in the existing TTS control surface: play, pause,
resume, stop, skip, rate, sentence/chunk progression, reading-position persistence,
sentence highlighting, auto-scroll, document/queue transitions, media/headphone
controls, background playback behavior, and cancellation when documents, providers, or
models change. No second playback UI SHALL be created. Perceived latency SHALL stay
low by synthesizing a first chunk before playback and generating later chunks
ahead of playback (prefetch), never by pre-generating an entire document.

#### Scenario: Long-form reading with prefetch
- **WHEN** the user reads several paragraphs continuously
- **THEN** sentences progress with highlighting, later chunks are prepared ahead of
  playback, and pause/resume/stop/skip behave consistently with other providers

#### Scenario: Provider/model switch cancels cleanly
- **WHEN** the user switches TTS model or provider mid-read
- **THEN** in-flight synthesis and playback stop, the native session is released or
  switched, and the new selection starts cleanly

### Requirement: Offline synthesis and privacy
Once installed, local TTS synthesis SHALL work entirely offline: no Hugging Face or
vendor contact during ordinary speech generation, no API key required, and no silent
transmission of text to cloud providers. Any failure SHALL respect the user's explicit
provider and fallback settings.

#### Scenario: Airplane-mode reading
- **WHEN** the device is offline and the user reads with an installed local model
- **THEN** synthesis and playback succeed with zero network activity

### Requirement: Resource lifecycle and stability
The system SHALL release native TTS sessions on model/provider change, app exit, and
(Android) memory-pressure/lifecycle events; SHALL bound memory growth across repeated
syntheses; SHALL cap inference threads sensibly for mobile thermals; and SHALL NOT
leak threads, processes, or native handles across long sessions.

#### Scenario: Extended session stays stable
- **WHEN** the user reads continuously for an extended period and then switches models
- **THEN** memory returns to a bounded level, no orphaned sessions remain, and a
  subsequent model load succeeds

### Requirement: Platform capability gating
The HF manager and TTS settings SHALL only present local TTS models as runnable on
platforms the current build can actually execute, based on detected runtime
availability and device information. Suitability messaging SHALL reflect CPU-first
reality (a missing discrete GPU alone SHALL NOT mark a device unsupported) and SHALL
not promise compatibility on platforms this build cannot serve.

#### Scenario: Unsupported build sees honest state
- **WHEN** a build lacks the native TTS runtime
- **THEN** installed TTS models are shown as registered-but-not-runnable (or hidden
  from runnable pickers) with an explanation, never offered as playable
