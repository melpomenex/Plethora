## ADDED Requirements

### Requirement: Word-level playback highlight

During audiobook playback with a loaded alignment map, the reader SHALL highlight the currently spoken word without recomputing alignment.

#### Scenario: Forward playback

- **WHEN** audio advances to a new word timestamp
- **THEN** the previous word highlight is removed and the new word is highlighted within one timeupdate cycle

#### Scenario: Seek

- **WHEN** the user seeks the audiobook
- **THEN** the reader updates to the word at the seek position

### Requirement: Efficient timestamp lookup

Playback lookup SHALL use indexed search (binary search or cursor with seek fallback) and SHALL NOT scan the full word list on every timeupdate.

#### Scenario: Large chapter

- **WHEN** a chapter contains 10,000 aligned words
- **THEN** lookup completes without perceptible UI jank

### Requirement: Bidirectional navigation

The system SHALL support audio-to-text and text-to-audio navigation using the alignment map.

#### Scenario: Tap word to seek

- **WHEN** the user taps an aligned word in sync mode
- **THEN** audiobook playback seeks to that word's start timestamp

#### Scenario: Audio seek updates reader

- **WHEN** the user seeks the audiobook forward 2 minutes
- **THEN** the reader scrolls to and highlights the corresponding text location

### Requirement: Degraded confidence behavior

When word-level confidence is below threshold, the system SHALL fall back to sentence or segment highlighting rather than showing incorrect word highlights.

#### Scenario: Low confidence chapter

- **WHEN** chapter confidence is below 0.3
- **THEN** only sentence-level or segment-level highlighting is shown and a warning is displayed
