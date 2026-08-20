# Spec Delta: dictionary-peek

## MODIFIED Requirements

### Requirement: Profile-aware content is additive

When a language profile is resolved, Dictionary Peek SHALL add surface/lemma/POS/morphology/context/translation/state actions while preserving the existing word/definition/phonetic/failure behavior for ordinary or unsupported lookups.

#### Scenario: No profile regression
- **WHEN** a user opens Dictionary Peek without Language Mode
- **THEN** the existing dictionary definition, TTS, Extract, flashcard, More, dismissal, and Queue-safety behavior remains available

### Requirement: Explicit state and memorization actions

Language-aware Peek state changes and Memorize actions SHALL be explicit and MUST NOT treat lookup/encounter as card creation. The standard selection lifecycle and accessibility paths SHALL remain intact.

#### Scenario: State without card
- **WHEN** a learner marks a selected word Learning
- **THEN** the language state changes and no learning item is created unless the user separately chooses Memorize
