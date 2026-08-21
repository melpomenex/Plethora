# Native Media Session Playback

## ADDED Requirements

### Requirement: Android SHALL expose one active native media session

Android SHALL expose one Media3 session/foreground media-notification lifecycle for the active long-form source. The session SHALL accept supported play/pause, next, previous, and seek actions from lock screen, notification, headset, car, Bluetooth, and smartwatch media controls.

#### Scenario: An Audio Edition is playing in the background

- **WHEN** the app is backgrounded or the screen is locked
- **THEN** the active Media3 session and notification SHALL remain available and SHALL route supported actions to the canonical dispatcher

#### Scenario: A headset media button is pressed

- **WHEN** a headset or car media event arrives
- **THEN** the native service SHALL normalize it into the shared command envelope with source/session identity

### Requirement: Native metadata and playback state SHALL be complete and current

The native session SHALL publish source kind and identity, title, artist/author, album/collection, artwork when available, duration, position, playback rate, current section/chapter, supported actions, and playing/buffering state. Updates SHALL be idempotent and scoped to the active source.

#### Scenario: The reader changes sections

- **WHEN** playback crosses to a new Audio Edition chapter or reader section
- **THEN** lock-screen and notification metadata SHALL update to the new section without losing the source identity or position

#### Scenario: A stale update arrives after a source switch

- **WHEN** an older source publishes a metadata or position update
- **THEN** the native session SHALL ignore it rather than replacing the active source state

### Requirement: Android audio focus and interruption behavior SHALL preserve intent

The media session SHALL distinguish permanent focus loss, transient focus loss, ducking, gain, and headphone disconnect. Automatic resume SHALL occur only for playback that was automatically interrupted, never for a user-paused session.

#### Scenario: Another app requests transient ducking

- **WHEN** the system grants a ducking interruption
- **THEN** Plethora SHALL duck or otherwise follow the platform ducking policy while preserving the playing state for restoration

#### Scenario: A phone call causes transient loss

- **WHEN** the system reports transient focus loss
- **THEN** Plethora SHALL pause as required, record the interruption reason, and resume on gain only if it was playing before the interruption

### Requirement: The foreground service lifecycle SHALL be singular and idempotent

Starting, updating, pausing, and stopping playback SHALL not create competing user-facing media notifications or duplicate media sessions. Native TTS and WebView audio SHALL use the same session contract or a subordinate implementation that cannot expose a second active media control surface.

#### Scenario: Native TTS starts while a reader session exists

- **WHEN** native TTS becomes the active source
- **THEN** the service SHALL transition the existing session or explicitly replace it, leaving one active notification and one command owner

#### Scenario: Playback stops

- **WHEN** the active source ends or the user stops it
- **THEN** the media notification/service SHALL be removed or made inactive according to platform policy without leaving stale controls

### Requirement: Desktop controls SHALL advertise actual platform capabilities

Supported desktop targets SHALL map OS play/pause, next, previous, relative seek, and absolute position when available through the existing bridge. Metadata/artwork and attach/detach lifecycle SHALL be tested per platform; unsupported capabilities SHALL be reported rather than simulated as successful.

#### Scenario: A supported desktop OS sends a seek command

- **WHEN** the OS emits a supported relative or absolute seek event
- **THEN** the Rust bridge SHALL produce the corresponding normalized command with source metadata

#### Scenario: Windows cannot provide a required handle or capability

- **WHEN** the platform setup does not support the requested integration
- **THEN** the app SHALL document or report the limitation and SHALL keep in-app controls functional

### Requirement: iOS support SHALL be conditional and honest

If a buildable iOS target exists, the shared session contract SHALL be implemented through a verified native media-control adapter. If no such target exists, the change SHALL document iOS as deferred and SHALL not claim untested native lock-screen support.

#### Scenario: No iOS target is present

- **WHEN** the project has no buildable iOS Tauri target
- **THEN** the implementation SHALL deliver the shared contract and explicit platform status without adding unverifiable native code
