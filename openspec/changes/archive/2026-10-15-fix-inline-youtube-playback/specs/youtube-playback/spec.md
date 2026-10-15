## MODIFIED Requirements

### Requirement: Tauri Inline Playback
The system SHALL support inline YouTube video playback in the Tauri desktop application without forcing users to external windows or dropping user playback interactions.

#### Scenario: Inline playback in Desktop App
- **GIVEN** the user is using the Tauri Desktop App
- **WHEN** the user opens a YouTube document
- **THEN** the video SHALL be playable inline within the document viewer
- **AND** opening the document SHALL mount the inline player directly without resetting to thumbnail mode
- **AND** the system SHALL NOT block inline playback when codec probes report missing local decoders
- **AND** the system SHALL NOT present options to open the video in a separate window

#### Scenario: Progress tracking with inline player
- **GIVEN** the user is playing a YouTube video inline
- **WHEN** the video progress updates
- **THEN** the system SHALL track and persist the playback position

#### Scenario: Linux WebKitGTK inline playback resilience
- **GIVEN** the application is running on Linux WebKitGTK
- **WHEN** a YouTube document is loaded and played inline
- **THEN** video and audio SHALL decode and composite without webview freezes or unhandled error states

#### Scenario: Thumbnail fallback and user interaction
- **GIVEN** the viewer is rendered in thumbnail mode or recovers from a playback state
- **WHEN** the user activates the play action
- **THEN** the viewer SHALL transition to the inline player and initiate playback
