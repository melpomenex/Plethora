# Proposal: Native Lock-Screen, Background, Headphone, and System Media Controls

## Why

Plethora already has a promising normalized media dispatcher, an Android Media3 session service, a durable native command queue, a desktop `souvlaki` bridge, and Audio Edition/listening-session synchronization. They are not yet one complete playback system. The Android session is mounted only by `AudiobookViewer`, its forwarding player does not receive full now-playing metadata or a real timeline, native Android TTS still uses a separate plain foreground notification, and `ReaderTTSControls`/`useTTS` bypass the bridge. Desktop metadata and platform coverage are partial, and the WebView queue has a response-shape mismatch that can strand commands after suspension.

This proposal finishes that native-control boundary as a separate, independently implementable change. It reuses the existing dispatcher, Audio Edition anchors, listening-session persistence, and study-mode mappings. It does not redo audio-edition generation, the listen-later inbox, or in-app review behavior.

## Current repository audit (2026-08-21)

- `src/utils/remoteMediaDispatcher.ts` already normalizes Play/Pause/Toggle/Next/Previous/seek commands, handles study-mode mappings, and deduplicates events. It is the intended command authority.
- `src/hooks/useRemoteMediaBridge.ts` is mounted in `src/components/viewer/AudiobookViewer.tsx`. It covers podcasts, audiobooks, and Audio Editions, but not `ReaderTTSControls`, the broader `useTTS` paths, or standalone native Android TTS.
- `src-tauri/plugins/plethora-android-tts/android/.../RemoteMediaSessionService.kt` exists with Media3 and a forwarding player. `updateMediaMetadata` currently carries only position/isPlaying, while the player/session do not expose a complete media item, duration, chapter, artwork, or timeline.
- `MediaCommandQueue.kt` durably stores pending native commands, but the plugin returns `{ commands: [...] }` while the frontend bridge currently treats the result as an array. The native queue and acknowledgement lifecycle therefore need an explicit contract and tests.
- `TtsPlaybackService.kt` remains a separate plain foreground service. Native TTS and reader-generated/system speech are not represented by the same OS media session, creating duplicate notification and focus/lifecycle risks.
- `src-tauri/src/media_control.rs` provides a desktop `souvlaki` bridge and normalized envelopes, but artwork, absolute seek, Windows configuration, and cross-platform verification are incomplete.
- `add-audio-editions-and-hands-free-study-mode` is marked complete in OpenSpec and its working pieces are present in the codebase. Its native-media portions are now an implemented foundation plus known gaps, so this proposal is a focused amendment/superseding continuation of that media-control scope rather than a second Audio Edition implementation.

## What Changes

- Define one long-form playback session contract for podcasts, local/generated audiobooks, Audio Editions, browser documents, EPUB/PDF/web-article reader TTS, generated audio, Web Speech, and native Android TTS. Each adapter exposes controls, state, position/duration, source identity, section anchors, and now-playing metadata.
- Generalize the existing `useRemoteMediaBridge` so exactly one active playback session feeds the canonical dispatcher and the platform adapter. Normal mode keeps transport semantics; Study Mode remaps only the configured secondary commands and continues to support capture actions.
- Complete the Android Media3 session/service: publish title/artist/album, duration, position, rate, chapter/section, artwork when available, supported actions, and accurate playback state; own the foreground media notification; handle headset/car/watch buttons and background lifecycle.
- Unify native Android TTS with the same media-session/focus contract and remove or subordinate the duplicate plain TTS foreground notification. Non-seekable TTS sources must expose honest position capabilities rather than pretending to be seekable.
- Make the native command bridge durable and explicit: persist before WebView dispatch, drain with the actual `{commands}` response shape, acknowledge only after canonical dispatch acceptance, deduplicate by stable physical event identity, and reconcile stale/background state without replay surprises.
- Improve desktop metadata/action mapping and lifecycle across supported targets, including artwork and absolute-position handling where the platform bridge supports them. Document and test any OS-specific capability limits rather than claiming uniform behavior.
- Keep reading/listening synchronization intact: OS commands update the same audio position, section anchor, source position, and listening-session state used by in-app controls.
- Treat iOS as conditional. If no iOS target exists in the current Tauri project, deliver the shared contract and a documented platform capability boundary; implement native iOS controls only when a real build target and test path are present.

## Capabilities

### New

- `native-media-session-playback`: native session, notification, focus, background service, and hardware/system controls.
- `unified-long-form-playback`: one playback/session contract across audio editions, podcasts, audiobooks, reader TTS, generated audio, and native speech.
- `media-command-reconciliation`: durable, acknowledged, idempotent command delivery across desktop/native/WebView suspension.

### Modified

None. Existing Audio Edition, podcast-position, listening-session, and hands-free study capabilities remain compatible and are consumed through the new session contract.

## Impact

- Frontend: `src/hooks/useRemoteMediaBridge.ts`, `useMediaSession.ts`, `useTTS.ts`, `useNativeAndroidTTS.ts`, `ReaderTTSControls.tsx`, `AudiobookViewer.tsx`, remote dispatcher/types/tests, and listening-position synchronization.
- Android: `RemoteMediaSessionService.kt`, `MediaBridge`, `MediaCommandQueue.kt`, `AndroidTtsPlugin.kt`, `TtsPlaybackService.kt`, manifest/service lifecycle, Media3 player/session metadata, and Android unit tests.
- Desktop: `src-tauri/src/media_control.rs`, Tauri commands/events, platform configuration, artwork/seek mapping, and Rust tests/manual verification.
- Protocol/state: additive native metadata and command envelopes; the existing app-private pending queue remains durable. No user-content migration or new cloud service is required.
- Dependencies: use the existing Media3 dependencies; add no platform SDK unless a concrete target requires it. Keep the existing WebView audio path unless an implementation decision proves native playback migration necessary.
- Overlap: reuses the completed `add-audio-editions-and-hands-free-study-mode` dispatcher, anchors, settings, and listening inbox; supersedes only its incomplete/stale native-media assumptions. `fix-mobile-audiobook-playback` and `fix-desktop-audiobook-playback` remain playback-resolver work and are regression inputs, not replacements. This change is independent of `browser-import-smart-organization`.

## Definition of Done

1. Android lock-screen controls show the active title and source and control the active session.
2. Android notification actions expose play/pause, next, previous, and supported seek actions.
3. Android notification metadata updates on source, section, title, duration, artwork, and playback changes.
4. Android position, duration, rate, and play state remain accurate after backgrounding and resume.
5. Headset, car, Bluetooth, and smartwatch media-button events reach the canonical dispatcher.
6. Android audio focus distinguishes permanent loss, transient loss, ducking, and gain.
7. User-paused playback is not unexpectedly resumed after an interruption.
8. There is one active media-session/foreground-notification lifecycle for a playback source.
9. Native Android TTS participates in the same session contract or has an explicitly verified equivalent with no duplicate controls.
10. Reader TTS controls participate in the same command and metadata path as Audio Editions.
11. Podcasts, local/generated audiobooks, Audio Editions, generated audio, Web Speech, and native TTS have defined capability behavior.
12. Non-seekable sources report honest capabilities and never fake precise position.
13. Native commands are persisted before WebView delivery when suspension is possible.
14. Frontend draining handles the native `{commands: [...]}` response contract.
15. Commands are acknowledged only after accepted canonical dispatch.
16. Replayed deliveries are idempotent while legitimate rapid seeks are not suppressed.
17. Stale queued commands are bounded, observable, and do not cause surprising replay after a new session.
18. Play/pause remains transport in Normal and Study Mode; only configured secondary actions are remapped.
19. OS commands update reading/listening position and section anchors through existing sync services.
20. Desktop native controls publish supported metadata and action state on supported platforms.
21. Desktop seek and lifecycle behavior are covered by Rust tests and manual platform checks.
22. Windows-specific limitations or configuration are verified and documented rather than assumed.
23. A real iOS target is implemented only if present; otherwise the conditional boundary and shared behavior are documented.
24. Frontend, Rust, Android, and integration tests cover command routing, focus, metadata, queue recovery, and source adapters.
25. Manual physical-device testing covers lock screen, notification, wired/Bluetooth controls, interruption, background suspension, TTS, and resume synchronization.
