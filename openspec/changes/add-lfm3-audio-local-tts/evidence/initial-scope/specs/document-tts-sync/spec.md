## ADDED Requirements

### Requirement: Local narration preserves source position through segmentation
LFM3 live narration SHALL reuse existing anchored start resolution, including explicit selection, current visible position and documented fallbacks. Normalization, sentence/clause segmentation and transient leading clips SHALL preserve semantic source provenance. A lack of measured timing SHALL NOT justify guessing an intra-clip seek to the requested source word.

#### Scenario: Read from the middle of a PDF page
- **WHEN** the user starts LFM3 while viewing a readable paragraph halfway down page 37
- **THEN** narration SHALL start at the resolved visible word on that page and retain its page/word/token anchor

#### Scenario: Explicit mid-chunk selection
- **WHEN** a selected start word lies inside an already cached chunk without measured word timestamps
- **THEN** the system SHALL synthesize/cache an anchored leading slice beginning at the requested word instead of seeking approximately into the full clip

#### Scenario: Normalization changes word counts
- **WHEN** speech normalization changes a code/math/link span or word sequence
- **THEN** highlighting SHALL use the transformed-to-source span map or degrade to sentence/block precision without highlighting an unrelated source word

### Requirement: LFM3 alignment reports its actual precision
LFM3 SHALL omit measured word timings unless independently verified alignment exists. Approximate word interpolation SHALL use actual generated duration, retain the existing synthesized source marker and approximate styling, and SHALL NOT be persisted as measured timing. Exact audio-segment boundaries and estimated intra-segment sentence boundaries SHALL be distinguishable in edition metadata. Scanned PDFs without usable text/anchors SHALL use existing OCR/reflow or report extraction required.

#### Scenario: Audio-only model output
- **WHEN** an LFM3 clip contains audio and actual duration but no measured timestamps
- **THEN** the reader SHALL use transient approximate word timing or sentence/block highlighting without claiming measured alignment

#### Scenario: Scanned page lacks canonical words
- **WHEN** a PDF page has neither readable text nor completed OCR
- **THEN** the system SHALL request existing extraction/OCR and SHALL NOT fabricate narrated words or precise highlights

### Requirement: Live narration survives reader navigation through common playback ownership
LFM3 live narration SHALL continue when its reader surface unmounts or the user navigates elsewhere, using the same application playback owner, focus rules, global player and platform media controls as other listening. Reader surfaces SHALL subscribe to position rather than own playback lifetime. Listening checkpoints SHALL remain independent of another document's reading position and restore paused after cold restart.

#### Scenario: Navigate while reading aloud
- **WHEN** the user starts LFM3 narration and opens RSS, notes or another document
- **THEN** narration and global controls SHALL continue for the original source without remounting a hidden reader or resetting its position

#### Scenario: Read one article while listening to another source
- **WHEN** an audiobook is playing and the user opens an unrelated article without pressing Play
- **THEN** playback SHALL continue unchanged and the article's reading position SHALL not overwrite the listening source's position

#### Scenario: Stop then stale audio ends
- **WHEN** an old clip emits completion after Stop or a new narration epoch
- **THEN** it SHALL NOT auto-advance or alter current playback/highlighting

#### Scenario: Disconnect or restart
- **WHEN** headphones disconnect or the application cold-restarts during live narration
- **THEN** the current source position SHALL be retained and playback SHALL remain paused until an explicit resume
