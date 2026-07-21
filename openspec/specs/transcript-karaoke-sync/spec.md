# transcript-karaoke-sync Specification

## Purpose
TBD - created by archiving change fix-youtube-transcript-karaoke-sync. Update Purpose after archive.
## Requirements
### Requirement: Continuous Transcript Time Polling
The system SHALL continuously poll YouTube player current time during playback across all supported platforms (Desktop Tauri, Web/PWA, Mobile) and update the transcript player position without relying on single-shot effect triggers or static player refs.

#### Scenario: Time polling activates upon playback start
- **WHEN** YouTube video playback transitions to playing state
- **THEN** the viewer SHALL continuously update `currentTime` at least every 250ms (or 500ms on WebKitGTK Linux) and forward time updates to the transcript sync engine

### Requirement: Transcript Segment Auto-Follow
The system SHALL auto-scroll the active transcript segment to a comfortable reading offset in the panel as the video plays, including across cue transitions and minor inter-cue gaps.

#### Scenario: Active segment moves with video playback
- **WHEN** playback position reaches a transcript segment
- **THEN** the system SHALL mark the segment as active and smoothly auto-scroll the line into the comfortable reading region

### Requirement: Word-Level Karaoke Highlighting
The system SHALL highlight individual words as they are spoken using YouTube per-word timing offsets (`tOffsetMs`) when available from the transcript API, falling back gracefully to synthesized word timing approximations when per-word offsets are absent.

#### Scenario: Spoken word highlight advances in real time
- **WHEN** media playback reaches a specific word within an active transcript segment
- **THEN** the system SHALL highlight that exact word and advance the highlight seamlessly as subsequent words are spoken

