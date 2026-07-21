# youtube-playback Specification

## ADDED Requirements

### Requirement: Synchronized YouTube Transcript Playback
The system SHALL keep the displayed transcript panel in continuous synchronization with YouTube video playback, ensuring the active transcript segment and karaoke word highlight track playback in real time across all app platforms.

#### Scenario: Transcript follows YouTube video playback
- **WHEN** a user plays a YouTube video in the viewer
- **THEN** the active line of the transcript SHALL scroll automatically to track the video's current timestamp and highlight spoken words in real time
