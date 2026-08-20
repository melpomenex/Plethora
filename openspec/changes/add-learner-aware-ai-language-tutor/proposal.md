## Why

Plethora has AI passage actions, document Q&A, semantic retrieval, and an existing adaptive tutoring proposal, but a generic assistant does not know the learner's target language, known vocabulary, current learning load, or recent encounters. A language tutor should be grounded in the learner's actual library and state while remaining provider-flexible and privacy-aware.

## What Changes

- Add a learner-aware language tutor with conversation, document discussion, sentence explanation, comprehension, vocabulary practice, roleplay, guided writing, and contextual grammar modes.
- Build compact retrieved learner-state context from profile, lexicon, evidence, recent content, and interests rather than dumping the full database.
- Support configurable lexical familiarity target, new-word weaving, correction modes, source attribution, persistence, privacy/opt-out, local/BYO/hosted providers, and graceful fallback.
- Extend existing AI assistant/AI provider/retrieval infrastructure; do not create a proprietary model or course tree.

## Dependencies

- Hard: profiles, lexicon/knowledge states, existing AI provider/retrieval/assistant context infrastructure.
- Soft: analytics, sentence translation, coverage, content generation, writing practice, existing `implement-plethora-teach-me-adaptive-ai-tutoring` and `add-ondevice-ai-learning-system`.
- This proposal specializes/extends those tutor capabilities for language state; coordinate before parallel edits to tutor context/UI.

## Capabilities

### New Capabilities

- `learner-aware-ai-language-tutor`: Modes, compact learner context, retrieval/ranking, lexical targeting, corrections, provenance, persistence, and privacy.

### Modified Capabilities

- `adaptive-tutoring`: Add language-profile/lexicon context and output controls without changing generic Teach Me flows.

## Impact

- AI context/retrieval services, provider adapters/settings/consent, tutor UI/session persistence, lexicon/analytics APIs, document/sentence source attribution, mobile/e-ink accessibility.
