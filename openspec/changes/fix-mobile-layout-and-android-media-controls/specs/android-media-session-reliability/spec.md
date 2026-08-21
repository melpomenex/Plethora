# Android Media Session Reliability

## ADDED Requirements

### Requirement: The Android manifest SHALL declare the complete media-service contract

The `RemoteMediaSessionService` manifest entry SHALL include the `androidx.media3.session.MediaSessionService` intent filter required by Media3 (verified against the pinned Media3 1.8.0) so media-button routing and service restart after process death function on supported Android versions. The application SHALL declare the `POST_NOTIFICATIONS` permission and request it at runtime on Android 13+ before media controls are needed, because without the grant the OS silently drops the media notification that carries lock-screen/notification controls. Any additional compatibility intent actions (e.g., `android.media.browse.MediaBrowserService`) SHALL be included only if verified as required or beneficial for the supported surface matrix.

#### Scenario: Playback is active on an Android 13+ device without prior notification grant

- **WHEN** the user starts playback for the first time on Android 13 or later
- **THEN** the app requests the POST_NOTIFICATIONS runtime permission at an appropriate moment and, once granted, the media notification with controls appears during playback

#### Scenario: The process is restarted from a media button event

- **WHEN** the system delivers a media button event after process death (media resume path)
- **THEN** the system can bind/start the declared MediaSessionService via its intent filter and queued or session state is handled without crashing

### Requirement: The native media service SHALL start only for a real playback session

The frontend bridge SHALL start the Android media-session service only when a meaningful playback or paused media session exists for the active source — not on component mount and not during generation/loading-only states. The complete playback snapshot (source identity, metadata, capabilities, state) SHALL be published before or atomically with service start. Generating/loading state SHALL be represented honestly (e.g., buffering/idle) and MUST NOT be reported as paused-with-media or trigger foreground promotion by itself.

#### Scenario: TTS generation is in progress but audio has not started

- **WHEN** TTS is generating audio and nothing is playing or paused-yet-resumable
- **THEN** the media-session service is not started (or is started only with an honest non-playable snapshot and no foreground media controls), and no misleading media notification appears

#### Scenario: Playback starts after generation completes

- **WHEN** generation completes and playback begins
- **THEN** the service starts (or promotes) with the complete snapshot and the media controls appear reflecting the playing state

### Requirement: Foreground promotion SHALL follow the Media3 playback lifecycle

The service SHALL let Media3's session/player lifecycle own foreground promotion for media controls. Any explicit `startForeground` usage SHALL be limited to what is required to satisfy `startForegroundService` contracts, SHALL be idempotent, and MUST NOT post a user-facing media-style notification before a playable/paused session exists. Starting, updating, pausing, and stopping SHALL be idempotent with no duplicate notifications or sessions.

#### Scenario: The service is started while the player is idle

- **WHEN** the service is created with no active media session
- **THEN** no media-style control notification is advertised to the user, and the service satisfies foreground-start obligations without showing playback controls

#### Scenario: The player transitions to playing

- **WHEN** the forwarding player reports a ready/playing state
- **THEN** Media3 promotes the service and the OS media surfaces (notification, lock screen) appear with correct metadata and actions

### Requirement: Metadata and state propagation SHALL be observable and fail loudly

The JS→native snapshot chain SHALL log non-spammy diagnostics at key points: service start/stop, session creation, metadata publication, player state transitions, foreground promotion/failure, command reception, teardown, and exceptions. Snapshot update failures SHALL NOT be silently discarded on either the JS or native side; they SHALL be surfaced (log at minimum, with rate limiting) so integration breaks are diagnosable via logcat.

#### Scenario: A metadata push fails

- **WHEN** a JS metadata snapshot push fails to reach or apply in the native layer
- **THEN** the failure is recorded in observable diagnostics rather than silently swallowed, and previously published state remains consistent

#### Scenario: An engineer debugs missing controls

- **WHEN** the engineer runs the documented logcat filter during playback
- **THEN** the logs show the service lifecycle, session creation, and metadata/state publication sequence needed to locate the break

### Requirement: The OS-facing media surface SHALL advertise only real capabilities and track app state

The Android media surface SHALL expose only commands the active source actually supports (play/pause always; next/previous/seek only where the adapter has real semantics) and its metadata (title, author/album where appropriate, section, artwork when available) and playing/paused state SHALL track the actual application state across foreground, background, and locked usage.

#### Scenario: Native sentence-based TTS is playing

- **WHEN** native sentence-based TTS is the active source without precise-seek support
- **THEN** the media surface shows play/pause and only commands with real semantics, and does not advertise arbitrary seeking

#### Scenario: The user locks the screen while playing

- **WHEN** the screen is locked during playback
- **THEN** the lock-screen media controls reflect the playing state and controlling them updates the app's actual playback

### Requirement: Service teardown SHALL be clean and verified

When playback ends or the session is dismissed, the native media service and its notification SHALL be removed cleanly with no stale controls, duplicate sessions, or leaked foreground state. `adb shell dumpsys media_session` SHALL show the expected single Plethora session only while a session exists.

#### Scenario: Playback stops and the app remains open

- **WHEN** the active source finishes or is stopped
- **THEN** the media notification and session are removed and `dumpsys media_session` no longer lists an active Plethora session

### Requirement: Physical-device verification SHALL be a mandatory completion criterion

The Android media integration SHALL NOT be considered complete without recorded physical-device verification covering, at minimum: native TTS, generated/cloud TTS, audiobook/local audio, pause, resume, lock screen while playing and while paused, notification shade controls, screen off, backgrounded app, return to app, Bluetooth headset play/pause, wired media buttons where hardware exists, next/previous and seek where supported, transient and permanent audio-focus loss, noisy unplug, and teardown. Automated tests do not substitute for this matrix.

#### Scenario: The verification matrix is executed

- **WHEN** the implementation agent completes the Android work
- **THEN** each matrix item is executed on a physical Android device and its result is recorded in the change tasks before the change is marked complete
