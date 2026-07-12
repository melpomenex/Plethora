## MODIFIED Requirements

### Requirement: Tauri Inline Playback
The system SHALL support inline YouTube video playback in the Tauri desktop application without forcing users to external windows. While playing inline, the system SHALL track and persist the playback position, and the accompanying transcript panel SHALL keep the currently spoken segment in view without requiring the user to scroll.

#### Scenario: Inline playback in Desktop App
- **GIVEN** the user is using the Tauri Desktop App
- **WHEN** the user opens a YouTube document
- **THEN** the video SHALL be playable inline within the document viewer
- **AND** the system SHALL NOT present options to open the video in a separate window
- **AND** the system SHALL NOT display warnings about inline playback stability

#### Scenario: Progress tracking with inline player
- **GIVEN** the user is playing a YouTube video inline
- **WHEN** the video progress updates
- **THEN** the system SHALL track and persist the playback position

#### Scenario: Transcript follows inline playback
- **GIVEN** the transcript panel is visible during inline playback and auto-follow is enabled
- **WHEN** playback advances and the active transcript segment changes
- **THEN** the transcript panel SHALL scroll so the active segment remains in a comfortable reading position
- **AND** the scroll SHALL respect manual user scrolling by pausing follow until the active segment re-enters view or the user seeks

## ADDED Requirements

### Requirement: Inline Playback Transcript Latency
The system SHALL provide low-latency active-segment updates during inline YouTube playback so the transcript tracks the spoken word rather than lagging behind it.

#### Scenario: Active segment updates promptly during inline playback
- **GIVEN** a YouTube video is playing inline with the transcript panel visible
- **WHEN** playback crosses into a new transcript segment's time range
- **THEN** the active segment SHALL be updated and scrolled into the reading position within 600ms
- **AND** the update SHALL NOT be suppressed by a per-segment throttle longer than 1 second
