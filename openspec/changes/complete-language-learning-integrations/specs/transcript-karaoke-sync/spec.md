## MODIFIED Requirements

### Requirement: Continuous Transcript Time Polling

The system SHALL continuously poll YouTube player current time during playback across all supported platforms (Desktop Tauri, Web/PWA, Mobile) and update the transcript player position without relying on single-shot effect triggers or static player refs. The language video host SHALL consume this existing time stream and SHALL NOT create a second polling loop or competing playback clock.

#### Scenario: Time polling activates upon playback start
- **WHEN** YouTube video playback transitions to playing state
- **THEN** the viewer SHALL continuously update `currentTime` at least every 250ms (or 500ms on WebKitGTK Linux) and forward time updates to the transcript sync engine

#### Scenario: Language mode consumes the playback clock
- **WHEN** Language Mode is enabled for a playing video
- **THEN** language sentence/token state SHALL update from the existing transcript time stream without adding a duplicate timer or changing the media position

### Requirement: Transcript Segment Auto-Follow

The system SHALL auto-scroll the active transcript segment to a comfortable reading offset in the panel as the video plays, including across cue transitions and minor inter-cue gaps. Language annotations and translation state SHALL not displace the active segment or break the existing follow behavior.

#### Scenario: Active segment moves with video playback
- **WHEN** playback position reaches a transcript segment
- **THEN** the system SHALL mark the segment as active and smoothly auto-scroll the line into the comfortable reading region

#### Scenario: Language overlay is mounted
- **WHEN** a language annotation or translation is displayed for the active segment
- **THEN** auto-follow SHALL continue to target the same transcript segment and SHALL preserve keyboard, touch, and screen-reader navigation

### Requirement: Word-Level Karaoke Highlighting

The system SHALL highlight individual words as they are spoken using YouTube per-word timing offsets (`tOffsetMs`) when available from the transcript API, falling back gracefully to synthesized word timing approximations when per-word offsets are absent. Language lexical-state styling SHALL remain a separate lower-precedence layer and SHALL not alter karaoke timing.

#### Scenario: Spoken word highlight advances in real time
- **WHEN** media playback reaches a specific word within an active transcript segment
- **THEN** the system SHALL highlight that exact word and advance the highlight seamlessly as subsequent words are spoken

#### Scenario: Language state and karaoke coexist
- **WHEN** the active spoken word has a language-state annotation
- **THEN** karaoke emphasis SHALL remain authoritative during playback and the language state SHALL remain available after playback advances

