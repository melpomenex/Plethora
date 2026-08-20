## 0. Dependency gates

Requires #1/#2/#7/#8. Freeze language-aware answer normalization, source resolver, and practice evidence before #19/#21/#22 integrate shared attempt history.

## 1. Comparison and session model

- [ ] 1.1 Define dictation prompt/attempt/source/error/normalization/retention types.
- [ ] 1.2 Implement Unicode/language-aware normalization and display diff with configurable tolerance.
- [ ] 1.3 Add compact practice history/evidence repository/API and optional learning-item link.

## 2. Practice UI and sources

- [ ] 2.1 Add Sentence Mode/reader/video/transcript entry points and hidden-answer accessible layout.
- [ ] 2.2 Integrate original-audio-first/alignment/TTS fallback, replay/loop/reveal/retry.
- [ ] 2.3 Add mobile/e-ink/external-keyboard and provider/offline states.

## 3. Verification

- [ ] 3.1 Test punctuation/case/diacritic/script normalization, missing/extra/substituted words, morphology/order, and raw-answer preservation.
- [ ] 3.2 Test each source type, stale alignment, offline/no-audio, accessibility, privacy, Queue/position invariants, and optional strengthening.
