## ADDED Requirements

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
