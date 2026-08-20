## 0. Dependency gates

Requires #1–#4 and #7. Freeze sentence identity, entry/return anchors, and control routing before #14, #15, #19, or #20 implement source-specific practice.

## 1. Session/index contract

- [ ] 1.1 Define sentence identity, source anchors, session entry/return state, stale-resolution, and progress semantics.
- [ ] 1.2 Add lazy sentence index adapters for EPUB, PDF reflow/canonical, HTML/Markdown/text, Queue, and transcript sources.

## 2. Mode implementation

- [ ] 2.1 Add opt-in Sentence Mode entry/route/panel with desktop/mobile/e-ink layouts.
- [ ] 2.2 Add Previous/Next, Play/Replay/Loop, translation reveal, vocabulary inspection, grammar action, Shadow seam, and exit behavior.
- [ ] 2.3 Integrate profile, lexicon/state, translation, TTS, and original-audio resolver interfaces.
- [ ] 2.4 Add loading/stale/unsupported/offline states and bounded AI context handling.

## 3. Verification

- [ ] 3.1 Test exact return anchors for all supported readers and repeated/changed sentence content.
- [ ] 3.2 Test Queue/review/position/listening invariants and no source mutation.
- [ ] 3.3 Test keyboard, touch, screen-reader, reduced-motion, e-ink, and large-document performance.
