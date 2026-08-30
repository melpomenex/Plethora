## ADDED Requirements

### Requirement: TTS spoken-word highlighting
When document TTS is active and `highlightSpokenWord` is enabled, the system SHALL highlight the currently spoken word in the reader using semantic locators when word-level timing precision is available.

#### Scenario: Word highlight during cloud TTS playback
- **WHEN** the user starts TTS on an EPUB chapter with a provider that returns measured word timings
- **THEN** the reader SHALL highlight the active word via `WordHighlighter.highlightAnchoredWord` without re-rendering the full document

#### Scenario: Approximate highlight for providers without timings
- **WHEN** the provider returns audio duration but no word timings
- **THEN** the system SHALL synthesize per-word timings over the chunk duration and render them with the approximate highlight style

#### Scenario: Chunk fallback when word resolution fails
- **WHEN** the highlighter cannot resolve a word locator in the DOM
- **THEN** the system SHALL fall back to chunk-level highlighting for that utterance

### Requirement: TTS chunk provenance
Every TTS synthesis chunk SHALL retain provenance mapping from provider timing offsets to canonical document locators via `ReaderSpeechIndex` words carrying `SourceAnchor`.

#### Scenario: Timing offset maps to locator
- **WHEN** a provider returns the Nth word timing for a chunk
- **THEN** the system SHALL associate that timing with the Nth `SpeechWord` in the chunk and its `SourceAnchor`

### Requirement: Semantic locator stability
TTS synchronization SHALL use stable semantic locators that survive font size changes, window resize, orientation changes, and EPUB reflow.

#### Scenario: Reflow preserves highlight position
- **WHEN** the user changes font size during TTS playback
- **THEN** subsequent word highlights SHALL resolve to the same semantic anchor offsets

### Requirement: PDF canonical word highlighting
For PDFs with a canonical text pipeline, TTS highlighting SHALL resolve words via `pdf-word` anchors and `[data-w]` DOM markers.

#### Scenario: Canonical PDF word highlight
- **WHEN** TTS plays text extracted from canonical PDF pages with word IDs
- **THEN** the highlighter SHALL target the element matching the spoken word's `wordId`

### Requirement: Scanned PDF degradation
When a PDF lacks a usable text layer for word-level mapping, the system SHALL NOT fabricate precise word highlights.

#### Scenario: Scanned PDF signals OCR requirement
- **WHEN** canonical analysis finds no native text words on a page
- **THEN** TTS highlighting SHALL degrade to chunk or page level and the reader SHALL NOT claim word-level precision

### Requirement: TTS pause resume position
Pausing and resuming TTS SHALL continue from the same semantic word position without restarting the document.

#### Scenario: Pause preserves word index
- **WHEN** the user pauses TTS mid-chunk and resumes
- **THEN** playback and highlighting SHALL continue from the paused word, not the chunk start

### Requirement: TTS seek updates highlight
Skipping to previous/next chunk or seeking within audio SHALL update the highlighted word to match the new playback position.

#### Scenario: Next chunk updates highlight
- **WHEN** the user skips to the next TTS chunk
- **THEN** the highlight SHALL move to the first word of the new chunk

### Requirement: Cached timing reuse
When cached TTS audio is reused, the system SHALL reuse compatible measured timing metadata stored alongside the cache entry.

#### Scenario: Cache hit restores timings
- **WHEN** a chunk's audio is loaded from cache with stored `wordTimings`
- **THEN** playback SHALL use those measured timings without regeneration

### Requirement: Timing cache invalidation
Stale timing metadata SHALL be invalidated when synthesis inputs change.

#### Scenario: Voice change invalidates cache
- **WHEN** the user changes TTS voice or provider
- **THEN** previously cached timings for a different voice SHALL NOT be applied to new synthesis
