## Why

Learners need to turn a meaningful reading/listening/watching moment into a study draft without manually reconstructing context. Plethora already has extracts, source anchors, media timestamps, and Flashcard Studio; sentence mining should compose those systems rather than create an isolated card editor.

## What Changes

- Add a shared “Mine sentence” action for document, EPUB, PDF, HTML/Markdown/article, transcript, audio, video, and YouTube readers.
- Capture sentence/phrase/target word, translation, neighboring context, analysis, source metadata/anchor, original audio range, timestamp, and optional frame.
- Open/create an existing Flashcard Studio draft with graceful missing-media behavior and explicit user acceptance.
- Preserve content, reader/listening position, Queue state, privacy, and provenance.

## Dependencies

- Hard: profiles, lexicon/knowledge states, processing/sentence anchors, existing extracts/Flashcard Studio and learning-item draft contracts.
- Soft: sentence translation, phrase tracking, sentence audio alignment, video mode, SRS integration, screenshot capture.
- Extends existing extract/source-navigation and Flashcard Studio capabilities; does not create a duplicate editor.

## Capabilities

### New Capabilities

- `language-sentence-mining`: Cross-source mining payload, context collection, provenance, draft routing, and graceful degradation.

### Modified Capabilities

- None; generic extracts remain available and source navigation is reused.

## Impact

- Shared selection/sentence action contracts, document/media viewer hosts, extracts/learning-items/Flashcard Studio APIs, source anchors, translations, alignment/media references, mobile/e-ink UI, and tests.
