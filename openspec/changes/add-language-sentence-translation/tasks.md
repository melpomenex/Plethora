## 0. Dependency gates

Requires #1/#2. Coordinate the sentence identity/cache/provenance contract with #8, #14, #15, and #17; do not let individual readers call providers directly.

## 1. Translation contract and cache

- [ ] 1.1 Define request/result/provider/capability/error/provenance/cache-key types.
- [ ] 1.2 Implement local/dedicated/AI provider adapter selection, privacy disclosure, retry, cancellation, and in-flight dedupe.
- [ ] 1.3 Add durable bounded cache metadata and invalidation for source/profile/provider/version changes.

## 2. Reader integration

- [ ] 2.1 Add profile translation settings and Target/Tap/Inline/Hidden modes.
- [ ] 2.2 Integrate sentence IDs/anchors for EPUB, PDF reflow/text, HTML/Markdown, Queue, and transcript/video adapters.
- [ ] 2.3 Add progressive rendering, reveal/hide, translation loading/error states, and source-preserving behavior.

## 3. Reuse and verification

- [ ] 3.1 Expose the service to Language Peek, Sentence Mode, future tutor, and mining contracts.
- [ ] 3.2 Test cache keys, provider failures, offline mode, repeated sentences, changed content, and no duplicate paid requests.
- [ ] 3.3 Test mobile/e-ink/reduced-motion/accessibility and reader/Queue/position regressions.
