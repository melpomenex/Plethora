# Tasks

## 1. Freeze the shared playback contract

- [x] 1.1 Define `LongFormPlaybackSession`, source kinds, capabilities, metadata, section/anchor, and state snapshot types alongside the existing remote-media types.
- [x] 1.2 Define the single normalized native command/ack/reconciliation envelope with event ID, source/session identity, timestamp, and failure/stale reasons.
- [x] 1.3 Add contract tests for Normal Mode, Study Mode mappings, transport invariants, and source-switch behavior.

## 2. Unify frontend playback hosts

- [x] 2.1 Refactor `useRemoteMediaBridge` to attach one active session adapter idempotently while preserving the current AudiobookViewer behavior.
- [x] 2.2 Adapt podcast, local/generated audiobook, and Audio Edition metadata, position, section, artwork, and capabilities to the shared session contract.
- [x] 2.3 Integrate `ReaderTTSControls` and `useTTS` generated-audio/Web Speech paths with the shared session rather than parallel media handlers.
- [x] 2.4 Integrate `useNativeAndroidTTS` state and controls with the same session identity, focus lifecycle, and honest sentence/seek capabilities.
- [x] 2.5 Remove or test-fail any competing production direct media-session handlers or native command routers.

## 3. Finish Android Media3 session behavior

- [x] 3.1 Update `RemoteMediaSessionService`/forwarding player to expose media item, timeline/duration, metadata, playback rate, supported actions, section, and accurate state snapshots.
- [x] 3.2 Extend `AndroidTtsPlugin` and the frontend bridge to send complete source/metadata/capability snapshots and to ignore stale source updates.
- [x] 3.3 Consolidate `TtsPlaybackService` with the one media-session/foreground lifecycle or make it a subordinate implementation with no duplicate notification/control owner.
- [x] 3.4 Implement the audio-focus/interruption state machine for permanent loss, transient loss, ducking, gain, and headphone disconnect without resuming user-paused playback.
- [ ] 3.5 Verify Media3 notification actions, lock-screen metadata, background lifecycle, headset/car/Bluetooth/watch events, and service teardown on a physical Android device.
  <!-- SUPERSEDED by fix-mobile-layout-and-android-media-controls Section 7: physical-device
       verification of this area (including its root-cause fixes: POST_NOTIFICATIONS runtime
       grant, MediaSessionService intent filter, service-start gating, foreground-promotion
       policy) is now a mandatory completion gate of that change. Check this box only when that
       change's Section 7 matrix has been executed. -->

## 4. Durable command bridge and reconciliation

- [x] 4.1 Make native queue records atomic, bounded, session-aware, and persisted before JavaScript delivery.
- [x] 4.2 Normalize the plugin drain result from `{ commands: [...] }` (with legacy-array compatibility) at one frontend boundary.
- [x] 4.3 Acknowledge only after canonical dispatch acceptance, preserve retryable failures, and add stale-command diagnostics/expiry.
- [x] 4.4 Replace broad source/command/time dedupe with event-ID identity and command-aware duplicate handling that preserves rapid distinct seeks.
- [x] 4.5 Reconcile native/frontend state after resume, source switch, queue drain, and accepted seek using monotonic freshness and source identity.

## 5. Desktop native controls

- [x] 5.1 Extend `src-tauri/src/media_control.rs` metadata/action mapping for supported play, pause, toggle, next, previous, relative seek, absolute position, artwork, and lifecycle operations.
- [x] 5.2 Verify platform configuration, including Windows window-handle/SMTC requirements, and document unsupported capability behavior.
- [x] 5.3 Add Rust tests for command mapping, metadata updates, attach/detach, position handling, and platform capability reporting.
- [ ] 5.4 Manually verify supported macOS, Windows, and Linux desktop controls and regression-check in-app playback.

## 6. Reading/listening synchronization

- [x] 6.1 Route accepted native/desktop commands through existing audio position, Audio Edition anchor, reader text position, podcast/audiobook persistence, and listening-session services.
- [x] 6.2 Verify source switches and background resume cannot apply stale position or section state to the new source.
- [x] 6.3 Verify Study Mode capture/review mappings and provenance remain unchanged for OS-originated commands.

## 7. Verification and handoff

- [x] 7.1 Add frontend unit/integration tests for adapters, metadata snapshots, capabilities, queue drain/ack, dedupe, suspension, and state reconciliation.
- [x] 7.2 Add Android unit/instrumentation coverage for Media3 state, focus transitions, queue persistence, event normalization, service lifecycle, and TTS integration.
- [ ] 7.3 Add manual physical-device coverage for Android lock screen, notification, wired/Bluetooth headset, car/watch controls, interruption, ducking, background suspension, TTS, and resume position.
  <!-- SUPERSEDED by fix-mobile-layout-and-android-media-controls Section 7 (same rationale as 3.5). -->
- [x] 7.4 Document the desktop platform matrix and the conditional iOS status; if an iOS target becomes buildable, add a native adapter and its manual test path.
- [x] 7.5 Run the relevant frontend, Rust, Android, and performance/regression checks and record any platform-specific limitations before handoff.
