## ADDED Requirements

### Requirement: A single canonical TTS playback position drives all derived state
The system SHALL maintain exactly one canonical playback-session position in `ReaderTTSControls` of the form `{ chunkIndex: number, wordIndex: number, intraChunkMs: number }`, where `intraChunkMs` is derived from the live audio engine clock (e.g. `audio.currentTime` for the cloud/system engines, the plugin's equivalent for the Android engine). The active-word highlight, the follow-scroll `wordKey`, the resume anchor, and the persisted listening position SHALL all be derived from this canonical position. The system SHALL NOT maintain separate mutable variables for "session start index", "current segment index", "paused segment", and "resume index" that can drift apart.

#### Scenario: Word highlight, follow scroll, and resume anchor move in lockstep
- **WHEN** playback is active and the canonical position advances from `{chunkIndex: 37, wordIndex: 12, intraChunkMs: 2400}` to `{chunkIndex: 37, wordIndex: 13, intraChunkMs: 2800}`
- **THEN** the highlighted word SHALL be word index 13 of chunk 37, the follow-scroll `wordKey` SHALL be `"37:13"`, and the resume anchor SHALL resolve to the same position

#### Scenario: Pausing does not mutate the canonical position
- **WHEN** the user pauses playback at canonical position `{chunkIndex: 51, wordIndex: 3, intraChunkMs: 1200}`
- **THEN** the canonical position SHALL remain `{chunkIndex: 51, wordIndex: 3, intraChunkMs: 1200}` and SHALL NOT revert to the session start position

### Requirement: Position state distinguishes canonical, derived, and persisted values
The implementation SHALL identify and document (in code structure) which values are canonical (the playback position above), which are derived (active word, follow-scroll key, reader anchor, resume anchor), and which are persisted (the TTS listening position record). Persisted state SHALL be written from canonical state and never from a transient derived value (e.g. a viewport-top word).

#### Scenario: Persisted position is written from canonical state
- **WHEN** a position save is triggered while the canonical position is `{chunkIndex: 51, wordIndex: 3, intraChunkMs: 1200}`
- **THEN** the persisted listening position SHALL encode chunk index 51 and word index 3 (and intra-chunk offset), not the viewport-top word and not the session-start chunk