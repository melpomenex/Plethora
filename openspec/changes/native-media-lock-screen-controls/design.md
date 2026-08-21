# Design: Native Lock-Screen, Background, Headphone, and System Media Controls

## Context

The current system has two strong but incomplete layers. The frontend dispatcher already owns normalized commands, study mappings, capture actions, deduplication, and provenance. The platform layer has a Web Media Session adapter, an Android Media3 `MediaSessionService`/durable queue, and a desktop `souvlaki` bridge. Production wiring is narrow: `AudiobookViewer` uses the bridge, while reader TTS and native Android TTS use separate control paths. Android metadata is reduced to position/isPlaying, `TtsPlaybackService` is a second foreground service, and the native queue’s object response is not aligned with the frontend drain cast.

The design keeps actual WebView audio where it already works and makes native surfaces faithful control/state adapters. It does not introduce a second command vocabulary or require a wholesale ExoPlayer migration.

## Goals / Non-Goals

### Goals

- Give Android lock screen, notification, headset, car, and watch controls one reliable path into the existing dispatcher.
- Give all long-form audio and speech sources a common session identity, metadata, capability, and position contract.
- Make background/WebView suspension safe with durable, acknowledged, bounded command delivery.
- Preserve Audio Edition anchors, reading position, listening sessions, and Study Mode semantics.
- Improve desktop integration within each platform’s actual capabilities and verify it physically.
- Leave a clear, honest iOS boundary when there is no iOS build target.

### Non-Goals

- Replacing Media3 with a new audio engine or migrating all WebView audio to ExoPlayer.
- Reimplementing Audio Edition generation, transcript generation, listen-later inbox, or hands-free settings.
- Adding a cloud media-control service or cross-device remote playback.
- Making Web Speech or native TTS falsely seekable at sample-level precision.
- Claiming iOS support without a buildable, testable iOS target.

## Decisions

### 1. One `LongFormPlaybackSession` contract

Introduce a source-neutral session/adaptor contract with stable source ID and kind, title/subtitle/artist, artwork, duration, position, rate, playing/buffering state, supported actions, current section/chapter, text/audio anchor, and capabilities for seeking/next/previous. It exposes play, pause, toggle, next, previous, seek-relative, and optional absolute-seek operations. The existing `RemoteMediaCommand`/envelope remains the transport vocabulary.

Adapters cover the existing `<audio>` path in `AudiobookViewer`, reader-generated audio chunks in `ReaderTTSControls`, podcasts/audiobooks/Audio Editions, Web Speech, and Android native TTS. Web Speech/native TTS report coarse sentence/word progress and unsupported seeking explicitly. The session owns one active adapter at a time, so there is one source of truth for OS metadata and command routing.

### 2. Generalize the bridge, do not duplicate handlers

`useRemoteMediaBridge` becomes the single production integration point for a long-form session host. `useMediaSession` remains the browser adapter for non-Tauri web builds; Tauri uses the desktop or Android adapter. Direct `navigator.mediaSession.setActionHandler` calls and ad hoc native button handlers are prohibited outside the adapter layer. Reader TTS and native TTS are connected through the same session callbacks, including lifecycle and metadata updates.

### 3. Android Media3 is the OS-facing owner

Keep `RemoteMediaSessionService` as the native OS-facing service. Its forwarding player represents the active WebView/native source with a real media item, duration/timeline, metadata, playback state, rate, and supported commands. The service updates one Media3 session and lets its media notification/foreground lifecycle reflect active playback. `AndroidTtsPlugin` sends a complete state snapshot (source, title, section, artwork, position, duration/capabilities, rate, playing) rather than only two scalars.

Native TTS either uses the same service through a native playback adapter or is explicitly represented by the same session while its actual `AudioTrack` remains owned by the TTS implementation. `TtsPlaybackService` is removed from the competing notification path or reduced to a subordinate implementation with no second user-facing media session. Service start/stop is reference/lifecycle based and idempotent.

### 4. Model audio focus as a state machine

The Android service records whether playback was user-paused, interrupted, ducked, or stopped. Permanent loss stops and clears resumable state; transient loss pauses only when required; `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` lowers volume or delegates ducking without converting a playing session into a pause; gain resumes only a session that was auto-paused for that interruption. Headphone disconnect follows the same policy and is tested separately.

### 5. Make command delivery durable and explicit

Native command records contain event ID, command, source, emitted time, optional hardware sequence/timestamp, and session/source identity. The queue appends atomically before JavaScript delivery. The plugin drain result is normalized to the actual `{ commands: [...] }` shape at one boundary, and older array-shaped responses may be accepted for compatibility. The frontend acknowledges only after the canonical dispatcher accepts the command; a command already applied by the same event ID is an idempotent acceptance.

Deduplication is identity-first: the same event ID is applied once. Source/command/time heuristics are used only for a verified duplicate delivery and are command-aware; they must not collapse legitimate rapid seek-forward/back commands. Commands older than the active-session/staleness policy are discarded with telemetry rather than silently replayed into a new source.

### 6. Synchronize source position and section identity

Every accepted command updates the adapter and the existing position/listening services. Audio Edition anchors and reader text/chunk positions are mapped into the session snapshot. On resume, the source adapter reconciles native state, WebView state, and persisted listening position using the active source ID and newest monotonic timestamp; a stale native snapshot cannot overwrite a newer user action.

### 7. Keep Study Mode semantics narrow and explicit

Play/pause remains transport in every mode. Next/previous and seek commands use current configured hands-free mappings only when Study Mode is active; capture actions retain durable provenance and the existing settings. Native surfaces need no study-specific UI: they send the same normalized commands and receive the dispatcher’s result.

### 8. Phase desktop and iOS by actual platform capability

The shared contract and Rust bridge are platform-neutral. On supported desktop targets, `souvlaki` publishes metadata and supported actions, maps relative and absolute position where available, and has an explicit attach/detach lifecycle. Windows configuration (including the current `hwnd: None` limitation) is verified before claiming SMTC parity. iOS is implemented only if a real target, native code location, and CI/manual build path exist; otherwise the app reports the conditional boundary and keeps the shared frontend behavior.

## Risks / Trade-offs

- A forwarding Media3 player is less rich than native ExoPlayer playback. The change keeps the stable WebView path, but requires accurate metadata/state and may still have platform-specific notification behavior.
- Combining native TTS and WebView audio increases lifecycle complexity. A single session ID, explicit source capabilities, and one foreground owner prevent duplicate controls.
- Android interruption policies differ by OEM. The state machine and physical-device matrix are required; unit tests alone are insufficient.
- Durable commands can replay old hardware events. Session identity, age bounds, explicit acknowledgement, and user-visible diagnostics make replay bounded and explainable.
- Desktop APIs expose different seek/artwork capabilities. The contract advertises supported actions instead of forcing parity.
- Reader TTS has chunk/sentence timing rather than continuous audio time. The UI and native metadata must expose the honest granularity.

## Migration Plan

1. Add the session contract and adapters behind existing dispatcher APIs; keep current AudiobookViewer behavior as the first adapter.
2. Wire Reader TTS, generated audio, Web Speech, and native Android TTS into the same session lifecycle.
3. Expand Android state/metadata and reconcile the native queue response/ack contract before changing notification ownership.
4. Consolidate the TTS foreground service and validate focus/interruption behavior on physical devices.
5. Complete desktop capability mapping and document iOS status.

Existing queue files and notification channels should remain readable during rollout. If native media is disabled, in-app controls and persisted reading/listening state continue to work; queued native commands may be safely expired by session identity and age.

## Open Questions

- Does the target Android API level/OEM set support all desired Media3 notification actions with the forwarding player, or is a small native player surface required for some actions?
- Should native TTS and Web Speech share the exact same session service or use a single frontend session with a native TTS-owned foreground adapter?
- Can the desktop build provide a real Windows window handle at bridge startup, and which artwork URI forms are accepted on each supported OS?
- Is there a buildable iOS target in a future branch, or should this change formally record iOS as deferred?
