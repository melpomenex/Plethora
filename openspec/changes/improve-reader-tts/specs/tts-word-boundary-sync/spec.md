## ADDED Requirements

### Requirement: Unified timing representation with source fidelity
TTS playback timing SHALL use the shared `WordTiming` model (`word`, `start_ms`, `end_ms`) extended with a timing source (`measured` or `synthesized`). Measured timings (provider word timestamps/speech marks/character alignment, Web Speech boundary data, native word events) MUST be preferred over estimates wherever available. Synthesized timings MUST be represented internally as approximate and MUST never be conflated with, persisted, or rendered identically to measured timings. Active-word resolution SHALL use the shared `findActiveWordIndex` semantics rather than a per-surface reimplementation.

#### Scenario: Provider with measured timings uses them
- **WHEN** a chunk plays whose provider returned normalized measured word timings that align with the chunk's word list
- **THEN** the active word follows the measured timings

#### Scenario: Misaligned measured timings fall back safely
- **WHEN** a provider returns timings whose word count does not align with the chunk text
- **THEN** the system discards them and uses the synthesized fallback instead of highlighting wrong words

#### Scenario: Approximate stays approximate
- **WHEN** timings are synthesized from audio duration
- **THEN** they are marked `synthesized`, drive a visually softer highlight, and are never persisted or reported as measured

### Requirement: Provider timing capability and normalization
Every TTS provider adapter SHALL declare whether it can return word timing/alignment metadata. Adapters whose upstream API supplies word timestamps, character alignment, speech marks, or token timing SHALL request and normalize that metadata into the shared TTS timing result on the provider result types; useful alignment MUST NOT remain buried in raw provider output. Normalizers SHALL map character/token timestamps onto the chunk's word boundaries positionally. Adapters whose APIs return audio only SHALL omit timings and rely on the shared synthesized fallback, using the actual generated audio duration when known.

#### Scenario: Capability is declared
- **WHEN** a provider adapter supports timing metadata
- **THEN** its capability declaration reports it and synthesis requests it, and results carry normalized `WordTiming[]` marked measured

#### Scenario: Audio-only provider uses deterministic fallback
- **WHEN** a provider returns audio without timing metadata
- **THEN** word positions come from the shared synthesized-timings fallback over the actual audio duration, never from a proportional character-position heuristic presented as truth

#### Scenario: Unknown timing payload shape
- **WHEN** a provider returns a timing payload the normalizer does not recognize
- **THEN** the adapter omits timings and playback proceeds with the fallback, without errors

### Requirement: System Web Speech word boundaries
For the System provider, the system SHALL use real `SpeechSynthesisUtterance.onboundary` data to update the active word, mapping the event's character index to the exact chunk word via the chunk's word boundaries. Duration estimation MUST NOT be used for the System provider when boundary events are available.

#### Scenario: Boundary event updates the exact word
- **WHEN** a boundary event fires mid-chunk during System TTS playback
- **THEN** the active word is the word containing the event's character index

### Requirement: Android native timing
The Android native bridge SHALL expose word-level position events when the underlying engine supplies them (word-range callbacks from the OS text-to-speech fallback engine), normalized into the shared timing model. When the engine genuinely provides only sentence boundaries, the system SHALL use the best safe fallback within the current sentence via shared synthesized interpolation marked approximate, while sentence-level position events remain timing anchors. Existing Android playback, prefetch, and auto-advance behavior MUST NOT regress, and stale utterance events MUST be ignored via utterance-identity filtering.

#### Scenario: Fallback engine word events
- **WHEN** the Android fallback engine reports a word range for the active utterance
- **THEN** the active spoken word updates exactly from that event

#### Scenario: Sentence-only engine interpolation
- **WHEN** only sentence-level position events are available
- **THEN** the active word advances approximately within the sentence from the sentence anchor, marked approximate

#### Scenario: Stale native events ignored
- **WHEN** a native event arrives for an utterance that was cancelled by a retarget
- **THEN** the event is ignored and never moves the highlight or playback state

### Requirement: Playback clock quality
For generated `<audio>` playback, `audio.currentTime` SHALL be the authoritative clock, sampled by an efficient update loop while playback is active; React state SHALL be committed only when the active word index changes, so the reader does not re-render at animation-frame rates. The update loop SHALL be suspended while paused, stopped, or the surface is hidden/unmounted. For measured-timing providers, the media clock SHALL be combined with the measured timings; for approximate timings, the shared fallback SHALL be used.

#### Scenario: No per-frame reader re-renders
- **WHEN** generated audio plays through a chunk containing dozens of words
- **THEN** active-word state commits approximately once per spoken word and the surrounding reader UI does not re-render every frame

#### Scenario: Pause freezes the active word
- **WHEN** playback is paused
- **THEN** the active word and highlight freeze at the paused position and the clock loop suspends

#### Scenario: Resume continues from the correct word
- **WHEN** playback resumes after a pause
- **THEN** the active word continues from the paused word
