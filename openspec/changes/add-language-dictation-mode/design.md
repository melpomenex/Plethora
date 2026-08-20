## Context

Existing TTS, transcript segments/word timings, audio editions, video playback, and answer assessment provide the source and comparison seams. Dictation must distinguish tolerant answer equivalence from meaningful language errors and avoid exposing the sentence before the learner attempts it.

## Dependencies

- Hard: #1, #2, #7, #8, and existing sentence/audio contracts.
- Soft: #13, #14, #11, #19, and #9.
- Share normalization/error/evidence contracts with #19/#20/#22; do not modify generic review answer assessment without coordination.

## Goals / Non-Goals

**Goals:**

- Make a bounded sentence-level dictation loop with original-audio preference.
- Provide normalized scoring plus visual diff/error categories.
- Record useful practice evidence without automatically creating cards.

**Non-Goals:**

- Perfect handwriting/OCR or phoneme scoring.
- Replacing generic flashcard answer assessment or scheduler.

## Decisions

1. **Source reference session.** Dictation attempt stores expected sentence/source anchor/media range, profile normalization policy, entered answer, normalized comparison, error categories, and optional translation/reveal state.
2. **Language-aware normalization pipeline.** Separate canonical comparison from display diff; configurable punctuation/case/diacritics tolerance, script-aware normalization, and no removal of meaningful characters by default.
3. **Original-first source resolver.** Use alignment, transcript/audio edition, video, vocabulary sentence, then TTS. Expose source type and exact replay range.
4. **Practice history and optional strengthening.** Store attempts compactly; offer explicit “practice this item”/strengthen action routed through existing learning-item review semantics, never silent rescheduling.
5. **Privacy/offline.** Typed answers remain local; no provider is required. Cloud audio/STT is not needed for core dictation because the learner types.

## Risks / Trade-offs

- [Normalization hides meaningful accents] → Show a clear toggle and display omitted accents separately even when tolerated.
- [Repeated/ambiguous sentence matches] → Use source sentence IDs/fingerprints and alignment confidence.
- [Audio unavailable] → Provide text reveal/skip and typed practice, not a broken loop.
- [E-ink keyboard constraints] → Keep sentence navigation/reveal simple and support external keyboard.

## Migration Plan

1. Add normalization/comparison utility and text/TTS dictation.
2. Add native audio/video/transcript sources and history.
3. Add optional evidence/recommendation/SRS links.

## Open Questions

- Default diacritic tolerance by language.
- Whether dictation attempts should be stored by default or only aggregate errors.
- Exact “accepted” threshold for partial sentences.
