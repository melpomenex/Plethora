## 0. Dependency gates

Requires #1–#4. Freeze the `LanguageAnnotationLayer`, visible-range invalidation, and precedence contract before parallel reader work; coordinate with `improve-reader-tts`, PDF selection, and existing highlight changes.

## 1. Shared annotation contract

- [ ] 1.1 Define token-state summaries, style modes, anchor confidence, layer precedence, and visible-range APIs.
- [ ] 1.2 Add profile settings and theme/accessibility tokens for state treatments, including e-ink/reduced-motion variants.
- [ ] 1.3 Implement indexed/incremental invalidation keyed by analysis and lexical-state versions.

## 2. Reader integrations

- [ ] 2.1 Integrate EPUB/HTML/Markdown/text through existing text/selection anchors.
- [ ] 2.2 Integrate PDF reflow and fixed PDF canonical word IDs with confidence gating.
- [ ] 2.3 Integrate Queue reader and transcript surfaces through adapters without changing Queue lifecycle.
- [ ] 2.4 Define coexistence CSS/DOM behavior with user highlights, search, TTS, selection, and e-ink.

## 3. Tests and performance

- [ ] 3.1 Test every knowledge state, missing analysis, stale map, profile switch, and Language Mode off.
- [ ] 3.2 Add reader regressions for EPUB, PDF fixed/reflow, HTML/article, Markdown, Queue, and transcript selection.
- [ ] 3.3 Add accessibility tests for contrast/labels/keyboard/screen reader and mobile touch tests.
- [ ] 3.4 Add large-document benchmarks and visible-range update tests; run `npm run bench:check` for intentional performance changes.
