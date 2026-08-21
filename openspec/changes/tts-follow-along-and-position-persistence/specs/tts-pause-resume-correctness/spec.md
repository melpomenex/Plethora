## ADDED Requirements

### Requirement: Pausing TTS freezes narration at the current playback position
The system SHALL freeze TTS at the current playback position when the user pauses. Pausing SHALL NOT reset the active segment, the highlighted word, the reader viewport, the persisted TTS position, the playback cursor, or the resume anchor to the segment where the TTS session originally started.

#### Scenario: Pause mid-session keeps the current segment (the #5 regression)
- **WHEN** the user starts TTS at segment 37, narration continues through segments 38–51, playback is currently around segment 51, and the user presses pause (mouse)
- **THEN** the active TTS segment, highlighted word, reader position, and persisted resume anchor SHALL remain at segment 51 and SHALL NOT revert to segment 37

#### Scenario: Pause from touch and keyboard/media control
- **WHEN** the user pauses using the touch control and the keyboard/media-control pause path
- **THEN** the behavior SHALL be identical to the mouse pause: position remains at the current segment

#### Scenario: Resume continues from the paused location
- **WHEN** the user pauses at segment 51 and then presses play again
- **THEN** narration SHALL continue from the paused location (within the pause/resume look-behind of at most the current sentence), SHALL NOT restart from segment 37, and SHALL NOT require a visible jump

### Requirement: Resume re-anchor only on deliberate user scroll or queued anchor
Resuming SHALL NOT re-anchor to the viewport-top word merely because the auto-follow viewport top sits in an earlier chunk. The system SHALL re-anchor on resume only when (a) the user queued an anchor (TOC navigation while paused — existing behavior, keep), or (b) the user deliberately scrolled while paused, in which case the viewport position SHALL be used with a small look-behind (current sentence start) for audible context.

#### Scenario: Resume with auto-follow viewport does not re-anchor backward
- **WHEN** the user pauses at segment 51 and the auto-follow viewport top is showing an earlier segment, then resumes without scrolling
- **THEN** narration SHALL resume at segment 51 (the paused word), and SHALL NOT re-anchor to the earlier segment visible at the viewport top

#### Scenario: Resume after deliberate scroll while paused re-anchors with look-behind
- **WHEN** the user scrolls to a different part of the document while paused and then resumes
- **THEN** narration SHALL resume from the viewport position, starting at the beginning of the current sentence (look-behind) for audible context

### Requirement: The pause path does not zero the active word state
The system SHALL stop advancing the word clock on pause without resetting the canonical position. `stopWordTracking` SHALL cancel the rAF loop but SHALL NOT reset `wordOffset`/canonical `wordIndex` to 0; the highlight SHALL remain on the last spoken word (or clear only the visual marker without changing position state).

#### Scenario: Highlight remains on the paused word
- **WHEN** the user pauses at word index 3 of segment 51
- **THEN** the canonical word index SHALL remain 3 and the highlighted word SHALL not move to word 0 or to segment 37

### Requirement: Text recomputation must not wipe session position
The `textFingerprint` reset effect SHALL stop resetting `chunkIndex`/canonical position to the session-start chunk and stop audio while the user is paused or mid-session for incidental text recomputation (EPUB `relocated` re-extraction, PDF/DOM re-extraction). The effect SHALL be limited to genuinely changed document text (fingerprint change) and SHALL preserve/restore the session position when the change is incidental or reconciles to the same content.

#### Scenario: EPUB relocated re-extraction while paused preserves position
- **WHEN** an EPUB triggers a `relocated` text re-extraction while TTS is paused at segment 51
- **THEN** the canonical position and playback SHALL remain at segment 51 and the session SHALL NOT be reset to segment 37

#### Scenario: Genuine document text change resets safely
- **WHEN** the document text genuinely changes (different fingerprint) such that prior anchors no longer exist
- **THEN** the session SHALL reset to the new document's start (or the resolution defined in position-persistence) and SHALL NOT throw or leave stale audio playing