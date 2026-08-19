## ADDED Requirements

### Requirement: TTS start priority order
When playback starts from a stopped state, the system SHALL determine the initial TTS position in this priority order: (1) an explicit selection/"Read from here" anchor if the user just invoked that action, (2) the live visible viewport anchor resolved at the instant Play is pressed, (3) the reader's authoritative current document position when the visible DOM cannot be resolved, (4) the saved persisted reading position, (5) the beginning of the available text. A stale saved scroll percentage MUST NOT override what the user is visibly looking at.

#### Scenario: Play halfway through a markdown document
- **WHEN** the user scrolls until a specific paragraph is the topmost visible content and presses Play
- **THEN** the first spoken word is the first visible readable word of that paragraph, and that word becomes the first spoken-word highlight

#### Scenario: Play halfway through an HTML/article document
- **WHEN** an imported HTML article is scrolled to its middle and Play is pressed
- **THEN** playback begins at the first visible readable word, not at the document start or a coarse chunk start

#### Scenario: Stale saved position does not override the visible viewport
- **WHEN** the persisted scroll percentage points at a different location than the currently visible viewport and Play is pressed
- **THEN** playback begins at the visible viewport location

#### Scenario: Visible DOM unresolvable falls back to authoritative position
- **WHEN** no visible word can be resolved (for example the target PDF page is not yet rendered) and Play is pressed
- **THEN** the system falls back to the reader's authoritative current position, then to the saved position, and never to an unrelated location

### Requirement: Deterministic first-visible-word resolution
The system SHALL resolve the viewport start anchor to the first word whose bounding rectangle has a deterministic, meaningful visible area inside the reading viewport: the intersection with the viewport MUST have at least 50% of the word's own height and non-zero width. Scanning SHALL proceed top-down in document order and stop at the first qualifying word. Fully clipped text and one-pixel slivers MUST NOT qualify. Rects MUST be translated correctly through iframe boundaries.

#### Scenario: Viewport begins halfway through a paragraph
- **WHEN** the reading viewport starts mid-paragraph such that the previous line is almost entirely clipped
- **THEN** playback starts at the first word of the first sufficiently visible line, not at the paragraph start

#### Scenario: One-pixel sliver never counts as visible
- **WHEN** a line of text has only a sliver (less than half its height) inside the viewport
- **THEN** that line's words do not qualify and resolution continues to the next line

#### Scenario: PDF halfway down a page
- **WHEN** the user is halfway down page 37 of a fixed-layout PDF and presses Play
- **THEN** playback starts around the first visible readable word on page 37, NOT at the beginning of page 37

#### Scenario: EPUB halfway through a chapter
- **WHEN** the user is halfway through an EPUB chapter and presses Play
- **THEN** playback starts at the first visible word, not at the chapter start or the previous chapter

#### Scenario: Multiple mounted EPUB iframes
- **WHEN** the EPUB continuous manager keeps several sections mounted and only a later section is in the viewport
- **THEN** the start anchor resolves inside the visible section, not inside the first mounted section

### Requirement: Anchored speech index with source mapping
The TTS chunking layer SHALL build an anchored speech index that preserves the mapping `displayed document text → normalized TTS text → word` while normalizing text for TTS. Every chunk SHALL expose its word list with per-word source anchors (EPUB spine index + section offset convertible to CFI, PDF canonical word ID or token ID, flattened-text offset, or page offset). Anchor resolution MUST be exact (chunk + intra-chunk word), MUST NOT guess word offsets from character displacement averages, and MUST use shared fold-for-matching normalization (Unicode NFC, curly quotes, apostrophes, dashes, ligatures) for all cross-surface text comparison.

#### Scenario: Repeated phrase anchors to the selected occurrence
- **WHEN** the same quotation appears on pages 10 and 90 and the page-90 occurrence is the requested start anchor
- **THEN** playback and highlighting address the page-90 occurrence and never jump to the page-10 occurrence

#### Scenario: Unicode differences do not break mapping
- **WHEN** the rendered document contains curly quotes, apostrophes, em/en dashes, or ligatures while the TTS text is normalized
- **THEN** word anchors still resolve to the correct document occurrence via fold-for-matching comparison

#### Scenario: PDF reflow maps back to canonical tokens
- **WHEN** a selection start lies in reflowed PDF content whose blocks carry canonical word IDs
- **THEN** the anchor maps to the same canonical reading token rather than to a string search

### Requirement: Mid-chunk exact start
When the resolved start word lies inside an existing TTS chunk, the system SHALL begin playback at that exact word by slicing the chunk at the word boundary into a transient leading chunk; the first audible text MUST be the requested word, not the chunk beginning. For generated-audio providers the sliced leading chunk SHALL be synthesized and cached under its own cache identity; the system MUST NOT blindly seek into a cached full-chunk clip that lacks measured word timings. After the leading chunk, playback SHALL continue with the normal chunk sequence, preserving buffering, auto-advance, EPUB chapter bridging, PDF continuation, and cache reuse.

#### Scenario: Selected word in the middle of a chunk
- **WHEN** the user selects a word that lies inside an existing 420-character TTS chunk and starts reading from it
- **THEN** the first audible generated text begins with the selected word and not with text earlier in that chunk

#### Scenario: Sliced leading chunk gets its own cache identity
- **WHEN** the same mid-chunk start is requested twice with the same provider, voice, and speed
- **THEN** the second request is served from cache without a new provider call, and the original full chunk remains cached under its own key

#### Scenario: Continuation after an exact start
- **WHEN** playback started at a mid-chunk word reaches the end of the sliced leading chunk
- **THEN** playback continues into the next chunk of the normal sequence with existing prefetch/buffering behavior intact
