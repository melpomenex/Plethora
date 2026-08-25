## Why

Natural encounters should build durable lexical evidence without flooding reviews, while Plethora already has Flashcard Studio, learning items, and selectable FSRS/Plethora Adaptive/Plethora Precision/Plethora Classic scheduling. The missing capability is an explicit, rich escalation from a word/phrase/sentence worth memorizing into that existing system.

## What Changes

- Add explicit Memorize actions for lexical entries, phrases, and sentence/constructions.
- Seed Flashcard Studio drafts with source sentence, cloze, meaning, lemma/morphology, pronunciation, audio, source metadata, and optional screenshot/frame.
- Support recognition, production, cloze, listening, and sentence-comprehension card formats through existing learning-item infrastructure.
- Add unobtrusive, dismissible suggestions based on lookups/encounters/failures/load without auto-creating cards.
- Link active/passive evidence and review outcomes back to the language lexicon.

## Dependencies

- Hard: profiles, lexicon/occurrences, knowledge states, existing Flashcard Studio/learning-items/review contracts.
- Soft: phrase tracking, sentence translation, audio alignment, sentence mining, shadowing/dictation.
- Extends `add-next-gen-srs-platform`, current learning-item/review APIs, and Language Peek; does not add a language scheduler.

## Capabilities

### New Capabilities

- `language-vocabulary-srs-integration`: Explicit escalation, rich draft seeding, suggestions, evidence linkage, and scheduler reuse.

### Modified Capabilities

- None; generic learning-item scheduling remains selected by user/configuration.

## Impact

- Lexicon-to-learning-item relation/schema, Flashcard Studio draft contracts/UI, learning-item APIs, source/audio provenance, review evidence, suggestion UI, and analytics.
- Migration/compatibility for current Dictionary Peek flashcard action.
