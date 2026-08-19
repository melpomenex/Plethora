# hands-free-study-mode Specification

## Purpose

Specifies media session integration per platform (native Android Media3, desktop media keys, web fallback; iOS conditional), a single normalized remote-command architecture, Normal vs. Study control profiles with configurable per-command mappings, durable background command handling, duplicate suppression, audio confirmation feedback, and offline hands-free operation.

## ADDED Requirements

### Requirement: Platform Media Session Integration (Explicit Per-Platform Truth)

The system SHALL integrate with host OS media services through exactly **one active command adapter per platform**, and the implementation SHALL distinguish explicitly between:

- **Android**: a native AndroidX Media3 `MediaSession` connected to a `MediaSessionService` foreground service (media notification, Bluetooth media buttons, lock-screen controls, headset/car remotes, audio focus). `navigator.mediaSession` web handlers SHALL NOT be registered on Android.
- **Desktop (macOS, Windows, Linux)**: a native Rust media-control bridge (macOS media keys, Windows System Media Transport Controls, Linux MPRIS) emitting normalized Tauri events and receiving metadata/playback-state updates.
- **Web (browser/dev)**: the W3C Media Session API adapter, used only when not running inside the Tauri app.
- **iOS**: `AVAudioSession` (playback category) + `MPRemoteCommandCenter`. **Conditional requirement**: the repository currently has no iOS build target; these requirements apply if and when an iOS target is added. Browser `navigator.mediaSession` SHALL NOT be presented as equivalent to native lock-screen support on any platform.

#### Scenario: Audio playback persists when the device is locked (Android)

- **WHEN** user locks their Android device while audio is playing and the Media3 foreground service is active
- **THEN** playback SHALL continue uninterrupted, the lock-screen media notification SHALL offer play/pause and next/previous actions reflecting the current mapping mode, and media-button events from connected Bluetooth/wired/car remotes SHALL reach the app

#### Scenario: Desktop media keys control playback

- **WHEN** user presses OS media keys (e.g. F8 next) while the desktop app is playing audio
- **THEN** the Rust media bridge SHALL emit the corresponding normalized command and the OS media UI SHALL show current title/playback state

### Requirement: Single Authoritative Normalized Command Dispatcher

All media command sources (native bridges, desktop bridge, web adapter) SHALL normalize into `RemoteMediaCommandEnvelope { command: Play | Pause | TogglePlayPause | Next | Previous | SeekForward | SeekBackward, eventId, source, occurredAt }` and route through one dispatcher (`dispatchRemoteMediaCommand`). The audio player SHALL NOT register competing direct media-session handlers; obsolete legacy handlers SHALL be removed.

#### Scenario: Bluetooth headphone command routed through the dispatcher

- **WHEN** any connected earbud sends an OS media command (such as Next)
- **THEN** the active platform adapter SHALL emit exactly one normalized envelope and the dispatcher SHALL handle it; no second (e.g. web) handler SHALL also fire

### Requirement: Duplicate Command Suppression

The dispatcher SHALL suppress duplicate envelopes within a short dedupe window (default 1500 ms) keyed by `eventId` or identical `(command, source)` pair, so one physical button press produces at most one action.

#### Scenario: Native and web double-delivery

- **WHEN** the same physical press surfaces through two paths with the same or replayed identity within the window
- **THEN** the dispatcher SHALL execute the action once and drop the duplicate

### Requirement: Durable Background Command Handling (Android)

On Android, every normalized command received natively SHALL be durably persisted (envelope with event ID and position metadata) **before** delivery to the WebView. The frontend SHALL acknowledge handled envelopes; on app resume/mount, unacknowledged commands within a staleness horizon (default 10 minutes) SHALL be reconciled through the same dispatcher, and commands whose playback position cannot be reconstructed SHALL produce a pending audio bookmark rather than being dropped silently. The design SHALL NOT assume the WebView JavaScript event loop remains alive while the device is locked.

#### Scenario: Button press while WebView is suspended

- **WHEN** a media button arrives while the WebView runtime is suspended and the app later resumes
- **THEN** the queued command SHALL be reconciled (or converted to a pending bookmark) and the user SHALL be able to identify the outcome — the press SHALL NOT be lost

### Requirement: Headphone Compatibility Standard

The system SHALL process any standard Bluetooth earbuds, wired headsets, car media buttons, or Bluetooth remotes that emit standard OS media commands, without manufacturer-specific SDKs. Vendor-reserved gestures (ANC toggles, proprietary assistant triggers) are out of scope. UI copy SHALL state that Plethora responds to the media command the headphones send, and that the physical gesture producing that command depends on the headphones.

#### Scenario: Third-party wireless earbuds connected

- **WHEN** earbuds from any vendor (AirPods, Galaxy Buds, Pixel Buds, Sony, Bose, generic) send an OS media command
- **THEN** Plethora SHALL process the resulting command identically regardless of brand

### Requirement: Normal vs. Study Mode with Per-Command Configurable Mappings

The system SHALL support two control profiles. In **Normal Mode**, commands retain ordinary transport behavior (`Next`/`Previous` → next/previous section or seek by platform convention, `SeekForward`/`SeekBackward` → +30s/−15s, play/pause unchanged). In **Study Mode**, each of `Next`, `Previous`, `SeekForward`, `SeekBackward` SHALL map to a user-configurable action from the complete implemented action set (`save_recent_extract`, `bookmark`, `replay_recent_passage`, `mark_interesting`, `mark_confusing`, `ask_plethora`, `skip_forward`, `skip_backward`, `next_chapter`, `previous_chapter`, `none`). Play/Pause commands SHALL never be remapped. Every action exposed in Settings SHALL be implemented and labeled; persisted invalid or legacy values SHALL fall back to defaults.

#### Scenario: Study mode changes Next behavior

- **WHEN** Study Mode is enabled with `Next → save_recent_extract` and a `Next` command arrives during playback
- **THEN** the dispatcher SHALL execute Save Recent Extract instead of skipping

#### Scenario: Disabling Study Mode restores navigation

- **WHEN** the user turns Study Mode off
- **THEN** the next `Next`/`Previous`/`Seek` commands SHALL perform ordinary navigation immediately, with no player restart required

#### Scenario: Legacy persisted mapping migration

- **WHEN** settings written by a previous version contain single/double/triple press actions or an unknown action value
- **THEN** the system SHALL migrate defensively (single-press → `Next` mapping) and substitute defaults for invalid values without error

### Requirement: OS-Command-Authoritative Interaction Model (Repeat Extension, No Gesture Inference)

The system SHALL treat the normalized OS command as authoritative and SHALL NOT infer vendor-specific multi-press gestures. When `save_recent_extract` is triggered again within the extension window (default 2.5 s) of a previous successful save in the same session, the system SHALL extend the same capture backward by one semantic unit (paragraph, else sentence group) — updating the existing extract and session item in place (no duplicate records), capped at 3 extensions — and play the extended confirmation earcon.

#### Scenario: Double-invoke extends the capture

- **WHEN** Save Recent Extract fires twice within 2.5 seconds
- **THEN** the system SHALL produce ONE extract whose text now includes the preceding paragraph, and SHALL NOT create a second extract or session item

### Requirement: Study Mode Discoverability and Player Quick Toggle

Study Mode state SHALL be persisted, SHALL be visibly indicated in the audio player whenever active (icon/chip with accessible label), and SHALL be quickly togglable from the player (with distinct enable/disable earcons). Normal Mode SHALL be the default. Settings SHALL provide explanatory copy about command remapping and headphone-gesture variability.

#### Scenario: User unknowingly leaves Study Mode on

- **WHEN** Study Mode is active and the user opens the player
- **THEN** the player SHALL clearly indicate Study Mode so ordinary navigation loss is never silent or invisible

### Requirement: Non-Intrusive, Configurable Audio Feedback

Hands-free actions SHALL produce distinct audible feedback: success earcons per action type (extract captured, extract extended, bookmark added, interesting marked, confusing flagged, ask enqueued), a distinct **failure** earcon when any action cannot be completed (a failure SHALL never sound like success), and study-mode enable/disable tones. Feedback SHALL honor the persisted chime-enabled flag and chime volume (0..1). Playback volume SHALL duck transiently and restore the exact prior volume without pausing audio; overlapping captures SHALL not race volume restoration; a manual volume change during the duck window SHALL win. Repeated captures SHALL reuse a single AudioContext.

#### Scenario: Extract saved hands-free while walking

- **WHEN** Save Recent Extract triggers via headphone while the phone is locked
- **THEN** playback SHALL duck briefly, the success earcon SHALL play at the configured volume, the exact prior volume SHALL be restored within ~500 ms, and narration SHALL never pause

#### Scenario: Capture fails

- **WHEN** a hands-free action's persistence fails
- **THEN** the failure earcon SHALL play (distinct from success) and the error SHALL be recorded for later surfacing — never silently swallowed

### Requirement: Offline Hands-Free Operation

Hands-free actions SHALL execute fully offline whenever the playing edition/audiobook and its anchor metadata (or timed transcript) are stored locally.

#### Scenario: Extract saved in airplane mode

- **WHEN** Save Recent Extract triggers with no network connection
- **THEN** the system SHALL resolve source text from local anchors/transcript and persist to local SQLite without error

### Requirement: Manual Acceptance Checklist (Android, Locked Screen)

The feature SHALL be considered verified only when this physical-device checklist passes: (1) Study Mode ON, Next → Save Recent Extract, capture window 30 s, an Audio Edition generated with anchors (or an audiobook with a timed transcript), ordinary Bluetooth earbuds connected; (2) start playback, confirm the player shows Study Mode; (3) lock the phone and listen > 30 s; (4) trigger the headset gesture the OS exposes as Next; (5) hear the success earcon while playback continues; (6) trigger a `Previous`-mapped command (default: replay recent passage) and hear playback rewind; (7) unlock, open the Listening Session Inbox; (8) verify the capture text matches what was heard, with source document/chapter/timestamp provenance; (9) use "Open in source" and land at the correct location; (10) create a flashcard from the capture; (11) disable Study Mode, lock again, and verify the same Next gesture now performs normal navigation; (12) repeat with a wired headset. One physical press SHALL yield exactly one capture throughout.

#### Scenario: Locked-screen end-to-end acceptance

- **WHEN** the checklist above is executed on a physical Android device with the screen off
- **THEN** every numbered step SHALL pass, including provenance correctness and single-dispatch
