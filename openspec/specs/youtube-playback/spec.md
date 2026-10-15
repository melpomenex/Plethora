# youtube-playback Specification

## Purpose
TBD - created by archiving change fix-tauri-youtube-inline. Update Purpose after archive.

## Requirements

### Requirement: Tauri Inline Playback
The system SHALL support inline YouTube video playback in the Tauri desktop application without forcing users to external windows. On Linux AppImage builds, the system SHALL pass a stable origin to the YouTube IFrame API to ensure postMessage communication succeeds regardless of the dynamic port assigned by WebKitGTK.

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

#### Scenario: AppImage YouTube playback on Linux
- **GIVEN** the user is running the AppImage build on Linux
- **AND** WebKitGTK assigns a dynamic `http://localhost:<port>` origin
- **WHEN** the user opens a YouTube document
- **THEN** the YouTube IFrame API origin parameter SHALL use a stable value instead of the dynamic `window.location.origin`
- **AND** postMessage communication between the parent page and the YouTube iframe SHALL succeed without origin mismatch errors
- **AND** video playback, state tracking, and position persistence SHALL function identically to other platforms

#### Scenario: Dev server YouTube playback unchanged
- **GIVEN** the user is running the app in development mode
- **WHEN** the user opens a YouTube document
- **THEN** the origin parameter SHALL use `window.location.origin` as before
- **AND** no behavior change SHALL occur compared to the current implementation

### Requirement: Synchronized YouTube Transcript Playback
The system SHALL keep the displayed transcript panel in continuous synchronization with YouTube video playback, ensuring the active transcript segment and karaoke word highlight track playback in real time across all app platforms.

#### Scenario: Transcript follows YouTube video playback
- **WHEN** a user plays a YouTube video in the viewer
- **THEN** the active line of the transcript SHALL scroll automatically to track the video's current timestamp and highlight spoken words in real time
