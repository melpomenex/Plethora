# Spec: language-sentence-mining

## ADDED Requirements

### Requirement: Shared mine action

Supported language-aware readers SHALL expose a Mine sentence action through their existing selection/action architecture. It SHALL work for a selected word, phrase, or current sentence and SHALL not create a separate editor.

#### Scenario: Mine from EPUB
- **WHEN** a learner selects a word in a Spanish EPUB and chooses Mine sentence
- **THEN** the nearest exact sentence and target selection seed an existing Flashcard Studio draft

### Requirement: Typed context payload

The mining payload SHALL include target sentence/word/phrase, optional preceding/following context, translation, definition/lemma/morphology, source title/document ID, source anchor, profile ID, and field availability/provider provenance.

#### Scenario: Missing morphology
- **WHEN** morphology is unavailable for the selected word
- **THEN** the draft remains valid and clearly omits/labels morphology rather than inventing it

### Requirement: Source-specific media

For aligned audio/video, the payload SHALL include original media ID/range and timestamp; optional frame may be included for video. For unaligned text it MAY include TTS fallback metadata. Native audio SHALL take precedence over TTS.

#### Scenario: Podcast mining
- **WHEN** a sentence is mined from a timestamped podcast transcript
- **THEN** the draft references the original podcast range and does not synthesize a replacement audio blob

### Requirement: Flashcard Studio routing

Mining SHALL open or create an editable Flashcard Studio draft using existing card/learning-item contracts. Final card creation SHALL require the existing explicit acceptance path unless the user intentionally chooses an immediate action.

#### Scenario: Edit before accept
- **WHEN** the user mines a YouTube sentence
- **THEN** Flashcard Studio opens with seeded fields and the user can edit/accept/cancel without changing the source video

### Requirement: Graceful degradation and no fake content

Missing anchor, translation, analysis, audio, or frame SHALL produce an explicit absent/needs-review field. The system MUST NOT create placeholder passage text or claim an unrelated source range.

#### Scenario: Anchor miss
- **WHEN** source anchoring fails for a selected sentence
- **THEN** the draft preserves the raw selection and marks source location unresolved for user review rather than fabricating a location

### Requirement: Reader/Queue safety

Mining SHALL preserve reader/listening position, selection, source content, Queue state, and review scheduling. Any extract/card is created only by the explicit user action/draft acceptance.

#### Scenario: Mine in Queue
- **WHEN** a learner mines a sentence in Queue Scroll Mode
- **THEN** the Queue item remains unrated/unadvanced and the reader returns to the prior location after draft cancellation

### Requirement: Privacy/caching/accessibility

Optional provider-backed translation/analysis/frame/audio work SHALL follow consent/cache rules and send bounded context. Mine controls SHALL support keyboard, touch, screen reader, reduced motion, and e-ink.

#### Scenario: Offline document mining
- **WHEN** the learner mines offline from a text document
- **THEN** source text/anchor and locally available metadata seed a draft without requiring AI or network
