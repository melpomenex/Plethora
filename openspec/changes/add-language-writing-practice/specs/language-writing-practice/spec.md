# Spec: language-writing-practice

## ADDED Requirements

### Requirement: Content-driven prompt modes

Writing Practice SHALL support responding to a current document, summarizing it, answering comprehension prompts, using target vocabulary, free writing, rewriting a sentence, and dialogue responses, with profile target/base language and source attribution.

#### Scenario: Article summary
- **WHEN** the learner chooses “Summarize this article in Spanish”
- **THEN** the prompt includes bounded article context and target profile, and the learner writes in the target language

### Requirement: Preserve learner output

The system SHALL preserve the exact learner version and SHALL not replace it with generated corrections. Drafts SHALL support edit, save, retry, cancel, delete, and optional export.

#### Scenario: Retry correction
- **WHEN** the learner edits their response and retries
- **THEN** the prior response/result remains in history or is replaced only by explicit user choice

### Requirement: Correction modes/categories

Users SHALL choose minimal, important, or detailed correction. Feedback SHALL distinguish grammar, morphology, spelling, word choice, register, unnatural phrasing, and meaning errors, with corrected/natural versions optional and labeled.

#### Scenario: Important corrections
- **WHEN** Important mode is selected
- **THEN** meaning-changing grammar/word-choice/morphology issues are prioritized and minor stylistic preferences are not presented as mandatory errors

### Requirement: Provider/privacy behavior

Correction SHALL use existing local/BYO/hosted AI provider abstractions and bounded learner/source context. Cloud use, retention, model, and consent SHALL be disclosed; without a provider, the learner can still write/save locally.

#### Scenario: Offline writing
- **WHEN** the device is offline without a local correction model
- **THEN** the learner can write/save the artifact and receives a clear correction-unavailable state

### Requirement: Active vocabulary evidence

Only an explicit accepted/self-assessed/validated production outcome SHALL add active vocabulary evidence. Showing a correction alone SHALL NOT mark words produced or Known.

#### Scenario: Accepted use
- **WHEN** the learner accepts that they correctly used `desarrollar`
- **THEN** active evidence may be recorded with practice provenance while passive state and SRS scheduling remain separate

### Requirement: Explicit SRS follow-up

The learner MAY send a selected correction/target word/phrase to the existing Memorize/Flashcard Studio flow. Writing SHALL not auto-create or reschedule cards.

#### Scenario: Memorize error
- **WHEN** the learner chooses Memorize on a repeated word-choice error
- **THEN** an editable shared language card draft opens with writing context

### Requirement: Accessibility/platform behavior

Writing editor, correction diffs, streaming/cancel, focus, keyboard, touch, screen reader, reduced motion, and e-ink behavior SHALL be supported; diff semantics SHALL not rely on color alone.

#### Scenario: Screen-reader diff
- **WHEN** a screen-reader user reviews correction feedback
- **THEN** issue categories and corrected text are announced in meaningful order without requiring visual color
