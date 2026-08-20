## MODIFIED Requirements

### Requirement: Tauri Inline Playback

The system SHALL support inline YouTube video playback in the Tauri desktop application without forcing users to external windows. Language Mode controls SHALL be hosted inline and SHALL not change the ordinary inline playback contract.

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

#### Scenario: Language Mode is enabled inline
- **GIVEN** the user is playing a YouTube video inline
- **WHEN** the user enables Language Mode
- **THEN** language controls and transcript actions SHALL appear in the existing inline host without opening a second player or resetting progress

### Requirement: Synchronized YouTube Transcript Playback

The system SHALL keep the displayed transcript panel in continuous synchronization with YouTube video playback, ensuring the active transcript segment and karaoke word highlight track playback in real time across all app platforms. Language sentence identity, lexical state, translation, and mining actions SHALL attach to the synchronized segment without changing ordinary playback timing.

#### Scenario: Transcript follows YouTube video playback
- **WHEN** a user plays a YouTube video in the viewer
- **THEN** the active line of the transcript SHALL scroll automatically to track the video's current timestamp and highlight spoken words in real time

#### Scenario: Language action uses the active segment
- **WHEN** the user chooses Translate, Peek, Replay, or Mine from the active transcript line
- **THEN** the action SHALL use that line's current sentence identity, timestamp range, media fingerprint, and profile context

