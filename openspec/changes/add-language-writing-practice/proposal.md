## Why

Reading recognition is not enough for active vocabulary. Plethora already has AI passage actions, document context, learner items, and analytics, but no writing practice that asks learners to produce target-language output and gives calibrated corrections tied to their actual material.

## What Changes

- Add writing modes: current-document response, summary, comprehension answer, target-vocabulary sentences, free writing, rewrite, and dialogue response.
- Add minimal/important/detailed correction with categories for grammar, morphology, spelling, word choice, register, unnatural phrasing, and meaning.
- Show learner version, minimally corrected version, natural version, and explanation where useful.
- Feed production evidence into active vocabulary and analytics, with explicit SRS follow-up only.

## Dependencies

- Hard: profiles, processing/lexicon/knowledge states, learner-aware tutor/AI context infrastructure.
- Soft: sentence translation, coverage, SRS, analytics, dictation/shadowing.
- Extends existing AI assistant/document Q&A/provider consent; no new scheduler or canned course.

## Capabilities

### New Capabilities

- `language-writing-practice`: Prompts, drafts, corrections, evidence, persistence, provider/privacy, and accessibility.

### Modified Capabilities

- None; generic AI passage actions remain available.

## Impact

- Practice session/draft schema, tutor/AI provider context, lexicon active evidence, analytics, current document/source anchors, UI on desktop/mobile/e-ink, and cost/privacy controls.
