## 0. Dependency gates

Requires #1–#7 and #13. Freeze the transcript sentence/token adapter, original-media resolver, and normal-mode boundary before #14 tasks touch shared video/transcript components.

## 1. Viewer integration

- [ ] 1.1 Define video-language session, transcript sentence/token adapters, layout state, and normal-mode boundary.
- [ ] 1.2 Integrate existing YouTube/local playback, captions/transcript, word timings, source anchors, and alignment resolver.
- [ ] 1.3 Add desktop/tablet/mobile/e-ink presentation with virtualized transcript and accessible controls.

## 2. Language behavior

- [ ] 2.1 Add profile activation, vocabulary state highlighting, shared Language Peek, and selection behavior.
- [ ] 2.2 Add target/base subtitle/translation modes, cache/error states, sentence seek/replay/loop/auto-pause.
- [ ] 2.3 Add mining callback with timestamp/source/frame-ready provenance.

## 3. Verification and overlap

- [ ] 3.1 Test normal playback regression, transcript sync, stale/low-confidence alignment, sentence-only fallback, and long transcripts.
- [ ] 3.2 Test mobile gestures, keyboard/screen reader, reduced motion, e-ink, offline translation, and Queue/listening invariants.
- [ ] 3.3 Coordinate shared viewer/transcript edits with existing YouTube/karaoke changes before parallel implementation.
