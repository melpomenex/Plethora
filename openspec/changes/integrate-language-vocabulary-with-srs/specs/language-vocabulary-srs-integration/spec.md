# Spec: language-vocabulary-srs-integration

## ADDED Requirements

### Requirement: Explicit memorization escalation

Users SHALL be able to explicitly Memorize a lexical entry, phrase, or sentence/construction. Natural encounter, lookup, highlight, or state change MUST NOT create a learning item by itself.

#### Scenario: Memorize a troublesome word
- **WHEN** the user accepts Memorize for a frequently looked-up lemma
- **THEN** a language learning draft is opened/created through existing Flashcard Studio and no duplicate language scheduler is involved

### Requirement: Rich source-linked seed

The draft SHALL support target word/phrase, source sentence, cloze, translation/definition, lemma, morphology, pronunciation, original/TTS audio reference, source title, document ID, and source anchor where available. Missing optional fields SHALL degrade gracefully.

#### Scenario: EPUB card seed
- **WHEN** a Spanish EPUB sentence is mined for `desarrollar`
- **THEN** the draft includes the target, context sentence, source anchor, meaning/analysis, and available audio reference

### Requirement: Existing item and scheduler reuse

Accepted drafts SHALL become existing Plethora learning items and SHALL use the user's selected FSRS/Plethora Adaptive/Plethora Precision/Plethora Classic scheduling algorithm and review controls. The integration MUST NOT add a language-only scheduler.

#### Scenario: Algorithm selection
- **WHEN** the user has selected Plethora Adaptive and accepts a vocabulary draft
- **THEN** the resulting learning item is scheduled by the same Plethora Adaptive path as other accepted items

### Requirement: Card format choices

The draft flow SHALL support recognition, production, cloze, listening, and sentence-comprehension formats where the existing item model can represent them, and SHALL show unsupported formats as unavailable rather than silently changing intent.

#### Scenario: Listening card without audio
- **WHEN** listening format is selected but no original/TTS audio can be produced
- **THEN** the format is unavailable or requires explicit fallback, and the card is not silently created with broken media

### Requirement: Suggestions are unobtrusive

The system MAY suggest Memorize based on explainable evidence such as repeated lookup/encounter, failures, usefulness, and current load. Suggestions SHALL be dismissible/snoozable, capped, and never auto-create cards.

#### Scenario: Repeated lookup suggestion
- **WHEN** a word has three lookups and repeated encounters
- **THEN** a dismissible suggestion may appear with a reason, while the review queue remains unchanged until acceptance

### Requirement: Review evidence linkage

Accepted language items and later review results SHALL link back to the language object/profile and contribute appropriately to passive/active evidence without overwriting manual knowledge state.

#### Scenario: Production success
- **WHEN** a production card is answered correctly
- **THEN** active-production evidence is recorded for the linked lexical object and normal review scheduling is updated

### Requirement: Duplicate and undo safety

The flow SHALL detect existing links/cards, explain duplicate choices, preserve source provenance, and use existing undo/delete semantics for immediate creation paths.

#### Scenario: Existing card
- **WHEN** the learner chooses Memorize for a word already linked to a learning item
- **THEN** the UI offers open/reuse/create-another according to existing duplicate policy and does not silently flood the deck

### Requirement: Privacy/provider fallback

Manual/source-based drafts SHALL work without AI. AI enrichment, translation, pronunciation, or audio providers SHALL be optional, disclosed, cached where possible, and labeled unavailable on failure.

#### Scenario: No AI key
- **WHEN** the learner memorizes a word with no AI provider
- **THEN** a basic source/definition draft can still be created from available dictionary/lexicon data
