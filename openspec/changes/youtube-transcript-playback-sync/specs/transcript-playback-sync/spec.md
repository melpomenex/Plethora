## ADDED Requirements

### Requirement: Active Segment Tracking
The system SHALL identify the transcript segment whose `[start, end)` time range contains the current media playback time, and update that active segment as playback advances.

#### Scenario: Active segment updates during playback
- **WHEN** media is playing and playback time enters a new segment's time range
- **THEN** the system SHALL mark the newly entered segment as active within 500ms
- **AND** the system SHALL visually highlight the active segment

#### Scenario: No active segment during gaps
- **WHEN** playback time falls between two segments (e.g. silence between captions)
- **THEN** the system SHALL keep the most recently active segment highlighted until the next segment begins

### Requirement: Follow Active Segment While Playing
The system SHALL keep the active transcript segment within the visible scroll region of the transcript panel during playback, so the spoken word and the displayed line stay aligned without manual scrolling.

#### Scenario: New active segment scrolled into view
- **GIVEN** the transcript panel is visible and auto-follow is enabled
- **WHEN** the active segment changes to a segment that is not in a comfortable reading position
- **THEN** the system SHALL smoothly scroll the transcript so the active segment rests at a comfortable reading offset (near the upper portion of the visible region)
- **AND** the scroll SHALL begin within 600ms of the active segment changing

#### Scenario: Active segment already in reading position does not jump
- **GIVEN** auto-follow is enabled
- **WHEN** the active segment changes to a segment already within the comfortable reading region
- **THEN** the system SHALL NOT scroll
- **AND** the system SHALL only update the visual highlight

#### Scenario: Short consecutive segments
- **GIVEN** the transcript contains consecutive segments shorter than 2 seconds
- **WHEN** the active segment advances rapidly through them during playback
- **THEN** the system SHALL follow each transition without a fixed per-segment throttle blocking the scroll

### Requirement: Pause Follow on User Scroll
The system SHALL detect when the user manually scrolls the transcript and pause auto-follow so it does not fight the reader, then resume once the active segment is relevant again.

#### Scenario: User reads ahead pauses follow
- **GIVEN** auto-follow is enabled and media is playing
- **WHEN** the user scrolls the transcript manually to a position far from the active segment
- **THEN** the system SHALL pause auto-follow and SHALL NOT scroll back to the active segment
- **AND** the system SHALL show an indicator that follow is paused with a control to resume

#### Scenario: Follow resumes after catch-up
- **GIVEN** auto-follow is paused because the user scrolled
- **WHEN** the active segment enters the visible region of the transcript panel again (playback catches up to where the user is reading)
- **THEN** the system SHALL resume auto-follow for subsequent segment changes

#### Scenario: Seek resumes follow
- **GIVEN** auto-follow is paused
- **WHEN** the user clicks a transcript segment (seeking the media)
- **THEN** the system SHALL resume auto-follow immediately and scroll to the clicked segment

### Requirement: Manual Auto-Follow Toggle
The system SHALL provide a user control to enable or disable auto-follow that persists across sessions per viewer, so users who prefer a static list can disable following entirely.

#### Scenario: Toggle persists across sessions
- **GIVEN** the user disables auto-follow via the toggle
- **WHEN** the user closes and reopens the same document viewer
- **THEN** auto-follow SHALL remain disabled
- **AND** the transcript SHALL not scroll on playback until the user re-enables it

#### Scenario: Disabled follow keeps highlight
- **GIVEN** auto-follow is disabled
- **WHEN** playback advances and the active segment changes
- **THEN** the system SHALL continue to highlight the active segment
- **AND** the system SHALL NOT scroll the transcript

### Requirement: Shared Follow Behavior Across Media Types
The system SHALL apply the same active-segment follow behavior to all media viewers that display a timestamped transcript list, so YouTube videos, local video files, and audiobooks behave consistently.

#### Scenario: Local video transcript follows playback
- **GIVEN** a local video file with a Whisper-generated transcript is open
- **WHEN** playback advances into a new transcript segment
- **THEN** the transcript panel SHALL scroll to keep the active segment in the comfortable reading region using the same rules as YouTube

#### Scenario: Audiobook transcript follows playback
- **GIVEN** an audiobook chapter with a transcription is open
- **WHEN** playback advances into a new transcript segment
- **THEN** the transcript panel SHALL scroll to keep the active segment in the comfortable reading region using the same rules as YouTube
