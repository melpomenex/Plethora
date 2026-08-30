## ADDED Requirements

### Requirement: Unified timed-text map
The system SHALL represent audio-to-text synchronization using a `TimedTextMap` containing ordered `TimedTextEntry` records with `startMs`, `endMs`, `locator`, and `granularity`, regardless of whether timings were produced by TTS synthesis or audiobook alignment.

#### Scenario: TTS produces timed-text map
- **WHEN** a TTS chunk is synthesized with word timings
- **THEN** the system SHALL build a `TimedTextMap` slice with one entry per word linked to `SourceAnchor` locators

#### Scenario: Audiobook alignment produces timed-text map
- **WHEN** an ebook-audiobook alignment map is loaded
- **THEN** the system SHALL adapt `AlignedWord` records into the same `TimedTextEntry` shape

### Requirement: Efficient playback lookup
Playback synchronization SHALL use `TimedTextPlaybackLookup` with cursor-based forward advance during normal playback and binary search after seeks.

#### Scenario: Forward playback uses cursor
- **WHEN** audio time advances sequentially within a word
- **THEN** lookup SHALL use amortized O(1) cursor advance without scanning the full map

#### Scenario: Seek uses binary search
- **WHEN** the user seeks backward or forward across multiple words
- **THEN** lookup SHALL binary-search the timed-text map and reset the cursor

### Requirement: Shared lookup across producers
Document TTS and audiobook alignment SHALL consume the same playback lookup implementation.

#### Scenario: Single lookup module
- **WHEN** either TTS or audiobook sync queries active text at time T
- **THEN** both SHALL call `TimedTextPlaybackLookup` from `src/lib/timedText/`

### Requirement: Playback rate independence
Changing playback rate SHALL NOT require regenerating timing maps; lookup uses wall-clock audio `currentTime`.

#### Scenario: Rate change preserves sync
- **WHEN** the user changes TTS playback rate
- **THEN** word highlighting SHALL remain aligned with audio playback position
