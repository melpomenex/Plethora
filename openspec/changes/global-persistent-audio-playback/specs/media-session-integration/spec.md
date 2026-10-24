## Purpose

Expose the active global audio session consistently to supported operating-system media controls, including reliable Android control while application JavaScript is unavailable.

## ADDED Requirements

### Requirement: One truthful platform media session
Each platform SHALL expose no more than one app media-session owner for current audio, with correct title, artwork/fallback, section, duration when known, position, rate and supported transport capabilities. Opening/closing source or expanded views SHALL NOT detach or duplicate OS controls. Stopping/closing the session SHALL clear its OS surface.

#### Scenario: Metadata follows takeover
- **WHEN** an audiobook replaces a podcast while multiple source views remain open
- **THEN** system metadata and transport target only the audiobook's current session
- **AND** a stale podcast metadata update cannot replace it

### Requirement: Android native transport and notification lifecycle
Android ordinary-media system Play, Pause, seek and section/queue actions where supported SHALL execute against the authoritative service session even with suspended application JavaScript. Standard controls SHALL retain effect exactly once after reconnection. Media notifications and focus/service eligibility SHALL follow platform rules, and notification-permission denial SHALL NOT be misreported as an unconditional playback prohibition.

#### Scenario: Seek while app is backgrounded
- **WHEN** a user seeks from lock-screen/headset controls while application JavaScript is suspended
- **THEN** the audible position changes immediately in the service
- **AND** reconnection reflects the resulting position without replaying the seek

#### Scenario: Notification permission denied
- **WHEN** notification permission is denied on a supported Android version and the user explicitly starts playback
- **THEN** the app follows media-session notification exemption and foreground-service rules
- **AND** it distinguishes actual platform/service failures from permission state without silently advertising broken controls

### Requirement: Preserved hands-free semantics and durable command identity
System commands SHALL preserve existing Normal and Study Mode mappings and source-provenance capture outcomes. Transport commands SHALL be deduplicated by event identity and bound to the originating session generation. Deferred learning actions SHALL preserve the source/section/press-time coordinate and SHALL NOT be attributed to whatever source is visible at replay time.

#### Scenario: Deferred study capture across source switch
- **WHEN** a Study Mode capture command is durably accepted in background and the user changes sources before reconnect processing
- **THEN** the capture resolves or records its typed pending outcome against the original source and press-time position
- **AND** it neither seeks the new source nor creates a capture with fabricated text/provenance

#### Scenario: Repeated explicit seeks versus duplicate delivery
- **WHEN** two separate headset seeks arrive with distinct event identities followed by a duplicate of the first
- **THEN** both intentional seeks apply once and the duplicate causes no additional seek

### Requirement: Desktop native adapter behavior
Linux media control SHALL use the existing MPRIS integration on supported D-Bus desktop sessions, Windows SHALL use valid native-window configuration for system transport controls, and macOS SHALL use its supported Now Playing/media-key integration. Platform failures SHALL retain in-app control and report truthful support/diagnostics without pretending system control succeeded.

#### Scenario: Linux compositor changes
- **WHEN** playback is controlled in supported Wayland and X11 desktop sessions
- **THEN** system transport controls the same active session without compositor-specific global key grabs

#### Scenario: Windows and macOS controls
- **WHEN** a packaged supported Windows or macOS build exposes current media and the user pauses from OS controls
- **THEN** the same global session pauses and updates all UI surfaces without restarting source loading

#### Scenario: Platform adapter unavailable
- **WHEN** an OS adapter fails to attach
- **THEN** in-app playback remains usable, the failure is diagnosable and the app does not claim successful system-media integration
