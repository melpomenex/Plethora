## ADDED Requirements

### Requirement: Language Mode is an explicit reader host capability

Supported reader hosts SHALL resolve the active language profile and expose language behavior only when the learner explicitly enables Language Mode or invokes an explicit language action. When Language Mode is disabled, missing, or unsupported, the host SHALL retain ordinary rendering, selection, scrolling, and position behavior.

#### Scenario: Language Mode is off
- **WHEN** a learner opens a document without an active Language Mode profile
- **THEN** the reader SHALL render the existing document path without language overlays, language requests, or language-driven position changes

#### Scenario: Profile switches while a reader is open
- **WHEN** the learner switches the active language profile while a reader is mounted
- **THEN** the host SHALL cancel stale language work, invalidate profile-scoped overlays, and rebuild only from the new profile without replacing source content or resetting the reading position

### Requirement: Reader hosts SHALL preserve reliable source identity

EPUB, PDF reflow/fixed, HTML/article, Markdown/text, Queue, and transcript-backed readers SHALL adapt their existing anchors into the shared `SourceAnchor`/`SentenceIdentity` contracts. The host SHALL not apply an annotation or action when the anchor is ambiguous, stale, or below the configured confidence threshold.

#### Scenario: Reliable occurrence is visible
- **WHEN** a visible token has a current analysis fingerprint and a resolvable source anchor
- **THEN** the host SHALL make its profile-scoped lexical state and language actions available for that occurrence

#### Scenario: Fixed PDF mapping is unreliable
- **WHEN** a fixed-PDF token cannot be mapped to a canonical word ID with sufficient confidence
- **THEN** the host SHALL leave that token unchanged and SHALL keep ordinary PDF selection and reading available

### Requirement: Language annotations SHALL coexist with existing reader layers

The language annotation layer SHALL remain separate from source text, user highlights, search marks, TTS highlighting, and selection. Selection and active spoken-word emphasis SHALL retain their existing precedence, and changing a lexical state SHALL update only affected visible annotations.

#### Scenario: User selects an annotated word
- **WHEN** the learner selects a word that has a language-state annotation
- **THEN** the selection interaction SHALL remain intact and the Language Peek SHALL receive the original selected text and source anchor

#### Scenario: TTS highlights an annotated word
- **WHEN** TTS speaks a word that also has a language-state annotation
- **THEN** the spoken-word highlight SHALL remain visually authoritative for its active duration and SHALL not mutate the lexical state

### Requirement: Reader language actions SHALL be source-grounded and explicit

Language Peek, translation, Sentence Mode, reading assist, pronunciation, replay, Extract, and Memorize actions SHALL receive the current profile, lexical identity, sentence/source anchor, and provider provenance where available. Actions that change knowledge state or create an SRS draft SHALL require an explicit learner action.

#### Scenario: Learner opens Language Peek
- **WHEN** the learner invokes Language Peek from a supported reader selection
- **THEN** the Peek SHALL show only available surface, lemma, morphology, meaning, translation, context, and audio capabilities for that source occurrence

#### Scenario: Learner memorizes a word
- **WHEN** the learner presses Memorize in Language Peek
- **THEN** the host SHALL create or update the shared language draft flow with provenance and SHALL NOT silently create a learning item for an incidental lookup

### Requirement: Reader audio and sentence actions SHALL prefer original media

Reader sentence replay and practice entry points SHALL resolve aligned original audio for the current source anchor before using existing TTS fallback. Translation reveal, replay, loop, and return-to-reader actions SHALL preserve the exact source sentence and reading position.

#### Scenario: Aligned original audio exists
- **WHEN** the learner replays a sentence with a valid native media range
- **THEN** the host SHALL play that range and identify it as original media rather than invoking TTS

#### Scenario: Native audio is unavailable
- **WHEN** no valid native media range can be resolved
- **THEN** the host SHALL offer configured TTS or a truthful unavailable state without replaying a different occurrence

### Requirement: Reader integrations SHALL degrade accessibly across platforms

Language controls SHALL be keyboard reachable, screen-reader labelled, touch usable, reduced-motion aware, and legible without color alone. Mobile and e-ink hosts SHALL provide compact controls and truthful unavailable states without blocking ordinary reading.

#### Scenario: Reduced motion or e-ink mode is active
- **WHEN** the learner uses reduced motion or an e-ink presentation mode
- **THEN** the host SHALL suppress decorative transitions, retain non-color state cues, and keep language actions usable

