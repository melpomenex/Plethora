## 0. Dependency gates

Requires #1–#4, #10, and existing AI/import contracts. Freeze generation provenance and measured-coverage handoff before #23 or tutor entry points consume generated candidates.

## 1. Generation contract and context

- [ ] 1.1 Define generation/adaptation request, learner-context budget, target settings, provider policy, cancellation, and provenance types.
- [ ] 1.2 Integrate profile/lexicon/coverage retrieval with existing AI provider/consent/quota infrastructure.

## 2. Document pipeline

- [ ] 2.1 Add generated/adapted document creation with source/version/provenance metadata and original preservation.
- [ ] 2.2 Add post-generation language processing/coverage measurement and target-vs-measured UI.
- [ ] 2.3 Add Simplify/Harder actions, topic/genre/length controls, retry/regenerate/cancel, and mobile/e-ink layouts.
- [ ] 2.4 Integrate normal reader/Queue/TTS/analytics and optional tutor/recommendation entry points.

## 3. Verification

- [ ] 3.1 Test profile separation, bounded context/privacy, provider failures, cancellation, provenance, source immutability, and measured coverage.
- [ ] 3.2 Test generated documents across EPUB/text/article reader paths, offline behavior, TTS fallback, accessibility, and Queue invariants.
