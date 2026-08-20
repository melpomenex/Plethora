## 0. Dependency gates

Requires #1/#3/#4 and existing AI/provider contracts. Coordinate with the adaptive tutor/on-device AI owners; #18 and #22 must consume the learner-context contract rather than fork tutor sessions.

## 1. Learner context and retrieval

- [ ] 1.1 Define versioned compact learner-context schema, sampling/ranking, privacy redaction, and context budgets.
- [ ] 1.2 Integrate profile/lexicon/state/analytics/current-document retrieval without loading full lexical data.
- [ ] 1.3 Add source attribution and grounded/general/generated labeling.

## 2. Tutor service and UI

- [ ] 2.1 Add provider-neutral tutor modes, soft lexical target, correction policy, session persistence, cancel/retry/delete/export.
- [ ] 2.2 Reuse existing AI assistant/provider/stream/consent/hosted/local settings and add language-specific configuration.
- [ ] 2.3 Add entry points from reader/sentence/video/Queue and desktop/mobile/e-ink accessible UI.

## 3. Verification and coordination

- [ ] 3.1 Test context size/ranking, profile separation, provider failures, privacy scope, corrections, attribution, and no-AI fallback.
- [ ] 3.2 Regression-test generic assistant/adaptive tutor/document Q&A and existing AI billing/consent behavior.
- [ ] 3.3 Coordinate with `implement-plethora-teach-me-adaptive-ai-tutoring` and `add-ondevice-ai-learning-system` before touching shared tutor files.
