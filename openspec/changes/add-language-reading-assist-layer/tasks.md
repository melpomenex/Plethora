## 0. Dependency gates

Requires #1/#2 and the #5 annotation/anchor contract. Freeze assist span, direction, capability, and accessibility semantics before integrating readers in parallel.

## 1. Contract/providers

- [ ] 1.1 Define assist kinds, annotation spans, direction/script, confidence, provider capabilities, versions, and cache keys.
- [ ] 1.2 Add local/provider adapter registry and truthful fallback/error handling.
- [ ] 1.3 Add bounded durable cache/result metadata and profile/content settings.

## 2. Reader layer

- [ ] 2.1 Implement shared layer host and source-span selection mapping.
- [ ] 2.2 Add Japanese/Chinese/Korean/RTL-capable adapters incrementally, including ruby/line-break/bidi-safe rendering.
- [ ] 2.3 Integrate EPUB, HTML/Markdown, PDF reflow where reliable, mobile, e-ink, TTS, and vocabulary-highlight coexistence.

## 3. Verification

- [ ] 3.1 Test unsupported capabilities, stale caches, mixed scripts, CJK, combining marks, RTL, selection, anchors, and source immutability.
- [ ] 3.2 Test accessibility verbosity, keyboard/touch, reduced motion, e-ink, mobile memory, and long-document performance.
