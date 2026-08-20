# Spec: language-dictation-mode

## ADDED Requirements

### Requirement: Hidden-answer dictation flow

The mode SHALL play a sentence/audio prompt without displaying the target sentence, accept a typed answer, compare it, then support reveal of expected sentence/translation, replay, retry, and exit.

#### Scenario: Basic dictation
- **WHEN** the learner plays `No podía creer lo que estaba viendo.` with the target hidden and types an answer
- **THEN** the result is shown only after submission with a meaningful comparison and reveal controls

### Requirement: Source preference

Dictation SHALL prefer current original audio/video ranges from alignment, then existing transcript/audio-edition sources, then TTS. It SHALL show source/fallback state and preserve replay range.

#### Scenario: Video sentence
- **WHEN** a video sentence has a timestamp
- **THEN** Play and Replay seek the original video/audio range rather than synthesizing TTS

### Requirement: Tolerant, language-aware comparison

Comparison SHALL support configurable tolerance for punctuation, capitalization, and optionally diacritics plus language-specific normalization. It SHALL keep the raw answer and distinguish tolerated differences from meaningful omissions/substitutions/extras.

#### Scenario: Missing accent
- **WHEN** expected text contains `podía` and the learner enters `podia`
- **THEN** the UI can mark the accent as a visible difference while applying the selected tolerance policy to the overall result

### Requirement: Error categories and feedback

Feedback SHALL identify useful word/character differences and categories such as spelling/diacritic, missing word, extra word, word order, morphology, or punctuation, without claiming errors where normalization says equivalent.

#### Scenario: Missing word
- **WHEN** the learner omits a verb
- **THEN** the missing word is highlighted and the expected sentence remains available for reveal

### Requirement: Practice history/evidence

Attempts SHALL retain profile/source/time, answer/comparison/error summary, and optional translation/audio references under retention policy. They MAY contribute to active/passive evidence and recommendations; they MUST NOT auto-create/reschedule SRS items.

#### Scenario: Optional strengthening
- **WHEN** the learner explicitly chooses strengthen linked vocabulary after a failed attempt
- **THEN** the action routes through existing learning-item/review policy and is visible/undoable

### Requirement: Offline/provider behavior

Core dictation SHALL work offline with stored/local text/audio and typed comparison. Missing media/translation SHALL be typed/retryable and SHALL not erase the attempt.

#### Scenario: Offline TTS unavailable
- **WHEN** no audio provider is available
- **THEN** the learner can reveal/enter text or exit cleanly, and no fake audio is reported

### Requirement: Accessibility/platform behavior

The mode SHALL support keyboard input, touch/mobile, screen readers, reduced motion, and e-ink/external keyboard, with clear hidden/revealed states and no answer leakage through labels.

#### Scenario: Screen reader hidden state
- **WHEN** a screen reader focuses the dictation prompt before submission
- **THEN** it announces controls/status but not the hidden target sentence
