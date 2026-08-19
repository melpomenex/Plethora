## ADDED Requirements

### Requirement: "Read from here" selection action
The selection toolbar SHALL offer a "Read from here" action (speaker icon from the existing Phosphor vocabulary) whenever TTS is enabled/configured and the current reader surface can map the selection to a valid reading anchor. The action SHALL integrate into the existing selection interaction system (toolbar chip, existing snapshot capture and dismissal flow), SHALL be available on desktop and mobile, and MUST NOT open a settings dialog.

#### Scenario: Action appears when TTS is available
- **WHEN** TTS is configured and the user selects text in a document reader
- **THEN** the anchored selection toolbar shows the "Read from here" action alongside the existing actions

#### Scenario: Action hidden when TTS is unavailable
- **WHEN** TTS is not enabled or the surface cannot map the selection to an anchor
- **THEN** the action is not shown and the toolbar layout remains usable

#### Scenario: Accessible label
- **WHEN** the action is rendered
- **THEN** it exposes an accessible label ("Read from here") via the i18n key, and keyboard workflows supported by the selection system can invoke it

### Requirement: Exact per-reader anchor extraction
The "Read from here" action SHALL take an immutable selection snapshot through the existing selection controller and derive the TTS start anchor from its start boundary using each reader's strongest anchor: EPUB selections use the start of the captured CFI range (never a chapter string search); PDF selections prefer the canonical `startWordId`, then the custom-selection `startTokenId`, then an exact native text-layer range/page anchor; PDF reflow selections map back to canonical reading tokens; OCR HTML selections use the OCR/reflow text anchor and reader offset; Markdown/HTML/article selections use the exact `TextSelectionContext.startOffset`. Duplicate text elsewhere in the document MUST NOT influence the starting point.

#### Scenario: EPUB selection uses CFI
- **WHEN** the user selects a word in an EPUB and chooses "Read from here"
- **THEN** playback starts at the CFI range's start, and repeated text earlier in the chapter does not redirect it

#### Scenario: PDF selection prefers canonical word ID
- **WHEN** a fixed-layout PDF selection carries a canonical v2 anchor and the user chooses "Read from here"
- **THEN** the start anchor is the canonical `startWordId`, not a string match

#### Scenario: PDF token ID fallback
- **WHEN** the selection has no canonical anchor but carries custom-selection token data
- **THEN** the start anchor is the `startTokenId`

#### Scenario: Markdown/HTML selection uses exact offset
- **WHEN** the user selects text in the Markdown or HTML reader
- **THEN** the start anchor is the selection's `startOffset` in the rendered document's flattened text, and no document-wide string search occurs

#### Scenario: Duplicate text starts at the selected occurrence
- **WHEN** the selected phrase also occurs earlier in the document and "Read from here" is invoked
- **THEN** playback starts at the selected occurrence

### Requirement: Continuous reading from the selection
"Read from here" SHALL start continuous reading at the first selected word and continue forward through the rest of the document/chapter normally. It is NOT selection-only playback. Invoking it SHALL stop/cancel any current TTS playback, rebase TTS chunking/buffering at the start point, immediately begin speaking at the first selected word with spoken-word highlighting active from that exact word, and collapse/dismiss the transient selection UI.

#### Scenario: Single word selection
- **WHEN** the user selects one word and chooses "Read from here"
- **THEN** that word is spoken first and highlighted, and reading continues past the selection

#### Scenario: Sentence and multi-sentence selections
- **WHEN** the user selects a sentence or multiple sentences and chooses "Read from here"
- **THEN** playback starts with the first selected word and continues beyond the selection end

#### Scenario: Selection UI dismissed
- **WHEN** "Read from here" is invoked
- **THEN** the selection toolbar collapses via the existing dismissal flow and playback proceeds

### Requirement: Safe retargeting from selection
Starting from a selection SHALL be race-safe: any in-flight generation, buffers, and native events belonging to the previous playback session MUST be invalidated so audio from the old location can never play; rapid repeated "Read from here" invocations MUST leave only the latest playback session active; cached audio MAY remain cached. When the selection cannot be mapped to a valid anchor, the system SHALL fail gracefully (surface an error, keep playback unchanged) rather than reading an unrelated location.

#### Scenario: Retarget while playing
- **WHEN** TTS is already playing and the user selects text elsewhere and chooses "Read from here"
- **THEN** old playback is cancelled, stale generation is ignored, and playback begins at the new location

#### Scenario: Rapid repeated invocations
- **WHEN** the user invokes "Read from here" at location A and immediately again at location B
- **THEN** only the session for location B ever becomes audible

#### Scenario: Old generation finishing after retarget
- **WHEN** audio generation for a previous location completes after the user retargeted
- **THEN** that result is never played (it may still be written to the audio cache)

#### Scenario: Unmappable selection
- **WHEN** the selection snapshot carries no usable anchor for the surface
- **THEN** an error is surfaced, playback state is unchanged, and no unrelated location is read
