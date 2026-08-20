# Spec: language-sentence-mode

## ADDED Requirements

### Requirement: One sentence at a time from source

Sentence Mode SHALL display one exact source sentence at a time using the processing/reader sentence index and SHALL not create a copied or mutated document.

#### Scenario: Sentence navigation
- **WHEN** the learner opens Sentence Mode for an EPUB
- **THEN** the current source sentence is shown with its source anchor and Previous/Next navigate adjacent source sentences

### Requirement: Translation and vocabulary inspection

The mode SHALL support hidden/revealed translation through the sentence-translation service and vocabulary inspection through the shared lexicon/Language Peek, with state and morphology shown only when supported.

#### Scenario: Inspect sentence word
- **WHEN** the learner taps `habías` in the current sentence
- **THEN** the shared Language Peek opens for that occurrence and closing returns to the same sentence

### Requirement: Audio controls

The mode SHALL provide Play, Replay, Loop, and a future Shadow entry. It SHALL use existing TTS initially and prefer original audio when a valid sentence alignment exists; missing audio SHALL not prevent text study.

#### Scenario: Loop TTS sentence
- **WHEN** the learner activates Loop without original audio
- **THEN** existing TTS repeats the current sentence until stopped, without changing source text or Queue state

### Requirement: Grammar/context assistance

An explicit grammar/context action MAY request provider-backed explanation using the current sentence and profile context. It SHALL be bounded, cancellable, privacy-aware, and labeled as generated/provider content; the mode SHALL work without it.

#### Scenario: AI unavailable
- **WHEN** grammar help is requested with no AI provider
- **THEN** the sentence and lexical/translation controls remain usable and the unavailable state is clear

### Requirement: Position preservation and return

Entering, navigating, and exiting SHALL preserve the exact normal-reader entry/return anchor, including EPUB CFI, PDF page/reflow anchor, text offset, transcript timestamp, or Queue reader location. Exiting SHALL not corrupt Queue/listening position.

#### Scenario: Return after navigation
- **WHEN** a learner enters from the middle of a PDF reflow document, moves five sentences, and exits
- **THEN** the normal reader returns to the stored entry location unless the learner explicitly chooses the current sentence as the new location

### Requirement: Loading/stale processing states

If sentence analysis is pending, stale, unsupported, or unavailable, the mode SHALL show a bounded loading/error state with retry/return options and SHALL never fabricate sentence boundaries.

#### Scenario: Processing pending
- **WHEN** a large document has not yet been segmented
- **THEN** Sentence Mode reports pending progress and the normal reader remains available

### Requirement: Cross-platform/accessibility behavior

Controls SHALL support mouse, keyboard, touch, screen reader, reduced motion, and e-ink. Focus order and labels SHALL identify sentence, translation, audio, navigation, and exit actions.

#### Scenario: E-ink mode
- **WHEN** Sentence Mode opens in e-ink mode
- **THEN** it uses a clean static high-contrast layout without motion-heavy transitions or video assumptions

### Requirement: Queue safety

Sentence browsing MUST NOT rate, complete, dismiss, postpone, reschedule, or advance a Queue item; any reading-state update SHALL use existing explicit position APIs only.

#### Scenario: Sentence Mode from Queue
- **WHEN** the learner opens Sentence Mode from a Queue item and exits
- **THEN** the item remains in its prior Queue state and the reader anchor is recoverable
