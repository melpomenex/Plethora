## ADDED Requirements

### Requirement: Highlight-only responsibility
Updating the spoken-word highlight SHALL NOT initiate document scrolling, compute viewport scroll offsets, or register interaction listeners for scrolling. `WordHighlighter` and `WordHighlightLayer` SHALL strictly own DOM highlight span management, class names, styles, and anchor resolution.

#### Scenario: Word highlight applied without side-effect scrolling
- **WHEN** `WordHighlighter.highlightAnchoredWord` or `WordHighlighter.highlightWord` applies a spoken-word highlight
- **THEN** the highlight DOM is updated and no `scrollTo` or `scrollIntoView` calls are dispatched by the highlighter

### Requirement: Single-pass highlight lifecycle and clearing
Spoken-word transitions SHALL perform at most one clear and re-highlight operation per update cycle. Redundant DOM destructions and normalizations MUST NOT occur between layer managers and highlighter instances.

#### Scenario: Spoken word advances to next word
- **WHEN** the spoken word offset updates during continuous playback
- **THEN** the previous highlight is cleared and the new highlight is inserted in a single clean pass without redundant intermediate clear calls

#### Scenario: Stop and pause highlight lifecycle
- **WHEN** playback pauses mid-utterance
- **THEN** the highlight remains frozen on the active word; when playback stops, all transient highlight spans are cleanly removed

### Requirement: Cache validity across DOM mutations
Cached highlight indexes (`IndexedText`) containing live DOM node references SHALL be invalidated or rebuilt whenever highlight operations, DOM normalizations, or document content changes alter `Text` node identity. Stale detached `Text` nodes MUST NOT be reused.

#### Scenario: Highlight application after previous word cleared
- **WHEN** a highlight is applied, cleared (normalizing parent text nodes), and a subsequent word is highlighted in the same container
- **THEN** the text index resolves against currently connected `Text` nodes rather than stale detached node references

#### Scenario: Container mutation invalidates cache
- **WHEN** container child nodes or text content are modified
- **THEN** the cached `IndexedText` is discarded and re-indexed on the next highlight query

### Requirement: Anchored highlight occurrence correctness and graceful fallback
The spoken-word highlight SHALL anchor to exact document locations (section offset, CFI, canonical token, or `[data-w]` PDF word ID) associated with the current speech chunk, constraining resolution to that section/page. Duplicate text elsewhere MUST NOT cause incorrect occurrences to highlight. When anchor resolution fails, the highlighter SHALL fall back gracefully to a constrained chunk highlight without throwing or corrupting the DOM.

#### Scenario: Duplicate text occurrences across sections
- **WHEN** identical text appears across multiple sections or paragraphs and TTS is narrating the second occurrence
- **THEN** the highlight appears strictly on the occurrence being narrated

#### Scenario: PDF word data-w resolution
- **WHEN** TTS is narrating a reflowed PDF with `pdf-word` anchors
- **THEN** the highlight targets the matching `[data-w]` element

#### Scenario: Anchor resolution failure fallback
- **WHEN** a word's section offset cannot be mapped to the current DOM
- **THEN** the highlighter applies a chunk-level fallback highlight without throwing exceptions

### Requirement: Multi-surface support and detached node safety
Spoken-word highlighting SHALL operate reliably across EPUB iframes, PDF text layers, PDF reflow/OCR HTML, Markdown, and HTML viewers on mobile and desktop. Detached or unmounted DOM nodes SHALL be handled defensively without throwing exceptions.

#### Scenario: Dynamic EPUB iframe switching
- **WHEN** EPUB navigation mounts a new chapter iframe and unmounts the previous one
- **THEN** highlighters for unmounted iframes are destroyed and highlighters for the active iframe initialize cleanly

#### Scenario: Virtualized text layer nodes
- **WHEN** PDF pages virtualize out of view while TTS highlights words
- **THEN** highlighting operations safely ignore detached text nodes without throwing or crashing
