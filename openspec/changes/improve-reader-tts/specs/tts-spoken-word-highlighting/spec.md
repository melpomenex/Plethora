## ADDED Requirements

### Requirement: Spoken-word highlighting enabled by default
When TTS playback is active in a document reader, the system SHALL highlight the word currently being spoken, enabled by default without requiring the user to discover a toggle. The preference SHALL be persisted in the TTS settings store (default on) with a user-facing toggle to disable it; highlighting state MUST NOT be unpersisted component-local state. When playback begins, the first spoken word SHALL highlight immediately; the highlight SHALL advance as speech advances.

#### Scenario: Fresh user gets highlighting without enabling anything
- **WHEN** a user with default settings presses Play in any document reader
- **THEN** the first spoken word is visibly highlighted and the highlight advances word by word

#### Scenario: Preference persists
- **WHEN** the user disables spoken-word highlighting and later reopens the document or restarts the app
- **THEN** highlighting remains disabled until re-enabled

### Requirement: Highlight lifecycle correctness
The spoken-word highlight SHALL freeze at the current word on pause, continue from the correct word on resume, and be removed on stop. Seeking, restarting, or retargeting playback SHALL move the highlight immediately to the new start word. Changing chapter or spine section MUST NOT leave a stale highlight behind; switching documents or unmounting the reader SHALL remove highlights and clean up listeners, injected styles, and iframe subscriptions.

#### Scenario: Pause and resume
- **WHEN** playback pauses mid-sentence and resumes
- **THEN** the highlight freezes on the paused word and resumes advancing from that word

#### Scenario: Stop clears the transient highlight
- **WHEN** playback stops
- **THEN** the spoken-word highlight is removed and the document shows no transient TTS marks

#### Scenario: Chapter change clears stale highlight
- **WHEN** EPUB playback advances to the next chapter (or the user navigates chapters)
- **THEN** no highlight from the previous chapter remains in any mounted iframe

#### Scenario: Document switch cleans up
- **WHEN** the user switches documents while TTS is active
- **THEN** highlights, listeners, and injected styles from the previous document are fully removed

### Requirement: Highlight anchors to the correct document occurrence
The spoken-word highlight SHALL be anchored to the document location (CFI, canonical word ID, token ID, or text offset) associated with the current TTS chunk, constraining highlight resolution to that anchor's section/iframe/page. Duplicate text elsewhere in the document (repeated sentences, quotations, headings, or the same sentence twice on a page) MUST NOT cause the wrong occurrence to highlight. Global first-match string search MUST NOT be used as the primary resolution mechanism.

#### Scenario: Duplicate quotation on two pages
- **WHEN** the same quotation appears on pages 10 and 90 and TTS is reading the page-90 occurrence
- **THEN** the page-90 occurrence is highlighted and the page-10 occurrence is untouched

#### Scenario: Repeated heading across sections
- **WHEN** two EPUB chapters contain identical quotations and TTS reads the second one
- **THEN** the highlight appears in the chapter being read

#### Scenario: Anchor resolution failure degrades gracefully
- **WHEN** the active word's anchor cannot be resolved to a DOM range
- **THEN** the system falls back to a constrained chunk-level highlight rather than highlighting a wrong occurrence

### Requirement: Highlighting works across all reader surfaces
Spoken-word highlighting SHALL work inside EPUB iframes (including multiple mounted sections), with PDF text layers in fixed layout, with PDF reflow/OCR HTML content, and with Markdown and imported HTML/article documents, on both desktop and mobile.

#### Scenario: EPUB iframe highlighting
- **WHEN** TTS reads an EPUB chapter rendered inside its iframe
- **THEN** the spoken word is highlighted inside that iframe

#### Scenario: PDF text layer highlighting
- **WHEN** TTS reads a fixed-layout PDF with a rendered text layer
- **THEN** the spoken word is highlighted in the text layer

#### Scenario: Reflow/OCR highlighting
- **WHEN** TTS reads reflowed or OCR-derived PDF content
- **THEN** the spoken word is highlighted in the reflow/OCR DOM

### Requirement: Visual distinctness and accessibility
The spoken-word highlight SHALL follow the established transcript karaoke visual vocabulary using theme tokens (primary), rendering measured timing with a stronger emphasis than approximate timing, and MUST remain clearly distinguishable from saved reader highlights, search result marks, active selections, and AI annotations. It SHALL respect light/dark themes, custom themes, e-ink mode (flat, high-contrast variant), and reduced-motion settings, and MUST NOT animate a pulse on every spoken word. Highlighting MUST NOT be conveyed solely by animation, screen-reader live-region announcements MUST NOT fire for every word, and focus MUST NOT jump on every spoken word; TTS controls retain meaningful accessible labels.

#### Scenario: Distinguishable from a saved reader highlight
- **WHEN** a user-created yellow highlight overlaps the spoken word
- **THEN** the spoken-word emphasis is visually distinct from the saved highlight and both remain identifiable

#### Scenario: E-ink mode
- **WHEN** e-ink display mode is active during TTS playback
- **THEN** the spoken-word highlight uses a flat high-contrast style without shadows or animation

#### Scenario: No per-word screen-reader chatter
- **WHEN** playback advances through a chunk
- **THEN** no live-region announcements are emitted per word and keyboard focus does not move
