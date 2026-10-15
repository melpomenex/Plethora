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

### Requirement: Shared word timing source metadata
Word timing records used for karaoke and document TTS SHALL support a `source` field distinguishing measured alignment from synthesized estimates.

#### Scenario: Synthesized timings marked
- **WHEN** word timings are synthesized from segment duration
- **THEN** each timing SHALL have `source: "synthesized"` and SHALL NOT be persisted as measured data

### Requirement: Shared active-word lookup
Karaoke and document TTS SHALL use the same `findActiveWordIndex` / `nextActiveWordIndex` helpers for playback-clock word selection.

#### Scenario: Consistent word selection
- **WHEN** audio current time falls within a word's timing window
- **THEN** `findActiveWordIndex` SHALL return the same index for karaoke and TTS consumers

### Requirement: Provider transcript audio seek
The system SHALL support seeking audio playback to the timestamp of a selected provider-generated transcript segment when segment timestamps are available.

#### Scenario: User clicks transcript segment during playback
- **WHEN** the user clicks a transcript segment with start timestamp 12:43 in a locally or cloud-transcribed recording
- **THEN** the audio player SHALL seek to 12:43

#### Scenario: Transcript without timestamps
- **WHEN** a completed transcript has no segment timestamps
- **THEN** the transcript SHALL remain readable and searchable without audio seek affordances

### Requirement: Provider transcript word-level highlighting
When provider results include word-level timestamps, the system SHALL highlight spoken words during playback using the same continuous time polling approach as YouTube karaoke sync.

#### Scenario: Word timestamps available during playback
- **WHEN** playback reaches a word with known start/end timing in a provider transcript
- **THEN** the system SHALL highlight that word and advance highlighting as subsequent words are spoken
