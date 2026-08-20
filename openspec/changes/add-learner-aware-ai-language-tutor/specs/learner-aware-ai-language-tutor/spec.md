# Spec: learner-aware-ai-language-tutor

## ADDED Requirements

### Requirement: Profile-aware tutoring

The tutor SHALL use the resolved target language, base/explanation language, proficiency estimate/preferences, and current profile state. It MUST NOT infer target language from application UI locale alone.

#### Scenario: English UI Spanish tutor
- **WHEN** a user runs the app in English with a Spanish profile
- **THEN** the tutor conducts configured target-language practice and explains in the profile base language as requested

### Requirement: Compact learner context

The tutor SHALL retrieve a bounded, versioned learner-state context containing relevant known/familiar/learning/difficult vocabulary, recent encounters, documents/interests, activity/evidence, and current source context. It MUST NOT send the entire lexicon by default.

#### Scenario: Current article context
- **WHEN** the learner asks to discuss the current Spanish article
- **THEN** the request includes the article/sentence context and ranked relevant state samples within the provider context budget

### Requirement: Modes and grounding

The tutor SHALL support conversation, current-document discussion, sentence explanation, comprehension questions, current-vocabulary practice, guided writing/roleplay, and contextual grammar. Library-grounded claims SHALL have source attribution; general/generated material SHALL be labeled.

#### Scenario: Explain sentence
- **WHEN** the learner requests grammar help for a sentence in an EPUB
- **THEN** the tutor cites the source sentence and distinguishes generated explanation from source text

### Requirement: Soft comprehensible-input targeting

The tutor SHALL support a configurable approximate familiarity target and intentionally weave a small set of current learning words where appropriate. It MUST treat the target as a guide, not a rigid percentage or guarantee.

#### Scenario: Target words
- **WHEN** the learner asks for a conversation using current Learning vocabulary
- **THEN** the tutor prefers mostly familiar language and includes a bounded selection of target words with optional labels

### Requirement: Correction controls

Users SHALL choose minimal/meaning-blocking, important, or detailed correction. Feedback SHALL distinguish grammar, morphology, spelling, word choice, register, unnatural phrasing, and meaning errors, and SHALL avoid overwhelming output by default.

#### Scenario: Minimal correction
- **WHEN** minimal correction is selected
- **THEN** the tutor focuses on meaning-blocking/important issues and does not list every stylistic preference

### Requirement: Provider flexibility and privacy

Local/on-device, BYO, and configured hosted providers SHALL use the existing provider abstraction. Cloud use, context scope, retention/cache behavior, quotas, and opt-out SHALL be disclosed; no provider is required for core language state.

#### Scenario: No provider
- **WHEN** no AI provider is configured
- **THEN** profile, lexicon, reader, dictionary, and manual practice remain usable and tutor explains that generation is unavailable

### Requirement: Persistence and controls

Tutor sessions SHALL persist conversation/source metadata through existing session patterns, support cancel/retry/export/delete, and avoid storing more learner context than needed.

#### Scenario: Delete session
- **WHEN** the user deletes a tutor session
- **THEN** its messages/source references are removed according to policy without deleting source documents or lexicon state

### Requirement: Cross-platform/accessibility

Tutor modes SHALL support desktop/mobile/e-ink, keyboard/touch/screen reader, reduced motion, streaming cancellation, and clear loading/error states.

#### Scenario: Screen reader streaming
- **WHEN** a screen-reader user starts a streamed tutor response
- **THEN** updates are announced accessibly without trapping focus and Stop cancels the request
