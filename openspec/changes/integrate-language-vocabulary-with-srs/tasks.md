## 0. Dependency gates

Requires #1/#3/#4 and the existing Flashcard Studio contract. Freeze draft, duplicate, provenance, and scheduler-reuse semantics before #6, #12, or #15 add language-card callers.

## 1. Draft and link contract

- [ ] 1.1 Define language draft/seed, card format, provenance, lexical-object link, provider metadata, and schema version.
- [ ] 1.2 Add migrations/repository/API methods for language-object-to-learning-item links and review evidence.
- [ ] 1.3 Add duplicate detection, idempotency, and existing undo/delete integration.

## 2. Flashcard Studio integration

- [ ] 2.1 Add explicit Memorize routing from Language Peek, phrase/sentence surfaces, and future mining.
- [ ] 2.2 Extend Flashcard Studio draft/preview editor for vocabulary, cloze, listening, production, and sentence context fields.
- [ ] 2.3 Implement original-audio-first/TTS fallback references and optional screenshot/frame metadata.

## 3. Suggestions and review evidence

- [ ] 3.1 Implement bounded explainable suggestion scoring, cooldowns, dismiss/snooze, and load safeguards.
- [ ] 3.2 Wire accepted items through existing scheduler/review algorithms and record active/passive evidence.

## 4. Verification

- [ ] 4.1 Test no-card-on-encounter/lookup/state-change, accepted draft creation, duplicates, missing providers, and provenance.
- [ ] 4.2 Regression-test all existing learning-item types, review algorithms, Queue state, mobile Flashcard Studio, and undo.
