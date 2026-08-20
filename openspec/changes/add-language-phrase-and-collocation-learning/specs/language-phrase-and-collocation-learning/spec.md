# Spec: language-phrase-and-collocation-learning

## ADDED Requirements

### Requirement: First-class phrase objects

The system SHALL represent multi-word expressions, collocations, and idioms independently from constituent single-word entries, with profile/language identity, normalized/display phrase, type, meaning, source occurrences, and knowledge/SRS state.

#### Scenario: Spanish idiom
- **WHEN** the user saves `tener en cuenta`
- **THEN** a phrase object is created with its own state and occurrences while `tener`, `en`, and `cuenta` remain independently queryable

### Requirement: User selection actions

Users SHALL be able to select a phrase and define/translate, save, mark state, Memorize, hear, view examples, and navigate to occurrences through the shared selection/Language Peek architecture.

#### Scenario: Phrase Peek
- **WHEN** a learner selects `on the other hand`
- **THEN** the shared Peek identifies phrase intent and offers phrase actions without reducing it to only the first word

### Requirement: Conservative candidate suggestions

The processing pipeline MAY suggest phrase candidates from deterministic/statistical/provider signals, but candidates SHALL include confidence/evidence and MUST NOT become visible highlights, phrase objects, or cards without user acceptance.

#### Scenario: Reject candidate
- **WHEN** a low-confidence n-gram candidate is dismissed
- **THEN** it is not highlighted or added to the learner's phrase state and may be snoozed

### Requirement: Independent state and memorization

Phrase knowledge state and deliberate SRS association SHALL be independent of constituent token state. Encountering or saving a phrase MUST NOT create an SRS item automatically.

#### Scenario: Phrase Learning
- **WHEN** a user marks a phrase Learning while all constituent words are Known
- **THEN** only the phrase state changes and no card is created until Memorize is accepted

### Requirement: Overlap and coverage rules

Phrase occurrences SHALL preserve their sentence/source span and define deterministic overlap behavior with token highlights, selection, search, TTS, and coverage. Coverage MUST NOT double-count the same source span accidentally.

#### Scenario: Phrase over tokens
- **WHEN** a phrase occurrence overlaps three token annotations
- **THEN** the reader applies the defined phrase/token precedence and coverage reports the documented single accounting result

### Requirement: Examples and audio

Phrase examples SHALL be paged/source-attributed. Replay SHALL prefer aligned original audio and fall back to TTS; missing providers SHALL not break phrase state/actions.

#### Scenario: Transcript phrase replay
- **WHEN** a phrase occurs in a timestamped transcript
- **THEN** the learner can replay the original segment and navigate to the transcript occurrence

### Requirement: Performance/privacy

Phrase candidates and occurrences SHALL be indexed/paged, generated lazily or in background, and shall not flood reactive state or send library content to cloud providers without explicit policy.

#### Scenario: Large library
- **WHEN** a profile has many phrase occurrences
- **THEN** examples load in bounded pages and candidate generation can be paused/cancelled
