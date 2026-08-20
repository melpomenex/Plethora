# Spec: language-aware-dictionary-peek

## ADDED Requirements

### Requirement: Reuse the shared selection Peek

Language Mode SHALL extend the existing `DictionaryPeek` and selection interaction stack. It MUST NOT introduce a reader-local language popover or change how ordinary text selections work when no profile is active.

#### Scenario: Queue and Documents parity
- **WHEN** the same Spanish word is selected in Documents and Queue
- **THEN** both surfaces open the shared Language Peek with the same profile-aware data and action semantics

### Requirement: Surface, lemma, and morphology display

For a selected form, the Peek SHALL show the encountered surface form and, when available with confidence, lemma, POS, morphology, pronunciation, meanings/translations, and source sentence. Unsupported fields SHALL be omitted or labeled unavailable.

#### Scenario: `hablando`
- **WHEN** Spanish processing resolves `hablando` to `hablar` as a gerund
- **THEN** the Peek shows both forms, the supported analysis, and the source context without replacing the surface text

### Requirement: Profile-language explanation

Definitions, translations, sentence translation, and contextual explanations SHALL use the active profile's target/base language configuration. AI explanation SHALL be optional and additive; core dictionary and manual state actions SHALL work without an LLM.

#### Scenario: Offline no-AI lookup
- **WHEN** a cached dictionary entry is opened offline with AI disabled
- **THEN** the Peek remains usable and does not show an indefinite AI loading state

### Requirement: Explicit language actions

The Peek SHALL expose applicable Pronounce, sentence Replay, state selector (New/Learning/Familiar/Known/Ignored), Memorize/Add to SRS, Extract, Examples, Explain, morphology/conjugation, phrase, and More actions. State changes and Memorize MUST be explicit user actions.

#### Scenario: Mark Learning without card
- **WHEN** the user selects Learning in the Peek
- **THEN** the lexical state updates and no learning item is created unless Memorize is separately activated

### Requirement: Audio preference

For a source sentence with a valid original-audio alignment, Replay SHALL use the original media segment; otherwise it SHALL fall back to existing TTS. The Peek SHALL surface unavailable media without blocking other actions.

#### Scenario: Native audio available
- **WHEN** the selected sentence has a timestamped podcast segment
- **THEN** Replay seeks/plays that source range rather than synthesizing TTS

### Requirement: Source and Queue safety

Peek lookup, state changes, pronunciation, translation, and dismissal SHALL preserve selection/source anchors, reading/listening position, Queue item state, and review scheduling. Extract/card creation only occurs through explicit action.

#### Scenario: Peek inside Queue
- **WHEN** a learner opens, uses, and dismisses Language Peek in Queue Scroll Mode
- **THEN** the current item remains mounted and unrated, and its position is unchanged

### Requirement: Failure and capability states

The Peek SHALL distinguish not found, unavailable, offline-uncached, unsupported analysis, and provider errors, with retry/fallback actions and no fabricated linguistic data.

#### Scenario: Morphology provider fails
- **WHEN** dictionary lookup succeeds but morphology fails
- **THEN** definition and state actions remain available and morphology is marked unavailable

### Requirement: Platform/accessibility behavior

Desktop keyboard/mouse, touch long-press, mobile bottom/anchored presentation, screen readers, reduced motion, and e-ink SHALL all reach the same semantic actions with labeled controls and no selection-clearing regression.

#### Scenario: Screen-reader state action
- **WHEN** a screen-reader user invokes Dictionary from the selection action sheet
- **THEN** the Language Peek exposes an accessible state selector and returns focus predictably on dismissal
