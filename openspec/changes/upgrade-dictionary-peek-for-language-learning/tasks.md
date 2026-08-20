## 0. Dependency gates

Requires #1–#4 and coordination with `unify-selection-dictionary-lookup`. Freeze profile-aware Peek target, state action, cache, and original-audio resolver contracts before #5, #7, #11, #12, or #15 add callers.

## 1. Target and service integration

- [ ] 1.1 Extend shared selection/Peek target types with profile, analysis, phrase, sentence, and source-anchor context.
- [ ] 1.2 Add profile-aware dictionary/analysis/translation lookup composition with cache keys, typed failures, and provider provenance.
- [ ] 1.3 Route lookup/interaction events to the durable lexicon without inflating counts on cache re-renders.

## 2. UI and actions

- [ ] 2.1 Add progressive Language Peek sections for surface/lemma/POS/morphology/meaning/context.
- [ ] 2.2 Add state selector, explicit Memorize, Extract, examples, morphology, phrase, replay, and More actions.
- [ ] 2.3 Implement original-audio-first replay with TTS fallback and preserve existing off-profile dictionary behavior.
- [ ] 2.4 Add i18n, mobile, e-ink, reduced-motion, keyboard, and screen-reader states.

## 3. Verification and migration

- [ ] 3.1 Test English/no-profile regression, Spanish inflections, unsupported languages, phrase selections, offline/cache/provider failures.
- [ ] 3.2 Test EPUB/PDF/HTML/Markdown/Queue selection anchors and Queue/review/position invariants.
- [ ] 3.3 Coordinate/archive overlap with `unify-selection-dictionary-lookup` before deleting or rewiring any existing local implementation.
