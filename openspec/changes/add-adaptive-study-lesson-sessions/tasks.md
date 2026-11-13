## 1. Lesson authority and durability

- [x] 1.1 Verify the knowledge-policy prerequisite and existing C7 tutor/diagnostic baseline, and reconcile the pending scoped-tutoring requirement before archive; record the source-backed and model-only launch contracts.
- [x] 1.2 Add versioned native lesson persistence, expected-revision and idempotent turn handling; test restart with a draft answer and hints, duplicate delivery and concurrent advancement.
- [x] 1.3 Adapt TutorSession to pinned authority and preflight; test strict scoped retrieval, missing/stale sources, model-only zero retrieval, mixed labels and consent invalidation when resuming or switching model.

## 2. Learner flows

- [x] 2.1 Add the versioned lesson route and Start/Continue actions; verify restoration at the same objective, and recovery if the plan or source changes.
- [x] 2.2 Wire Guided, Explain + Check and Challenge with reasoning input, source navigation, progressive hints, direct explanation and Skip; test the hint/probe limits, one focal question, style switch, and independent practice handoff with no final evidence from lesson turns.
- [x] 2.3 Connect optional diagnostic to provisional preview and the existing assessment/adapter; test take, skip, cancel, restart, pending grades, stale scope, model-only self-check and explicit acceptance of a compatible diff.

## 3. Integration verification

- [x] 3.1 Exercise native desktop and mobile lesson/diagnostic journeys with keyboard, touch, screen reader, reduced motion, narrow/landscape layouts and supported dictation; verify offline/local-model behavior and no-AI manual recovery.
- [x] 3.2 Run focused TutorSession, study, assessment and native persistence tests plus `npm run bench:check`; record evidence that tutor actions do not mutate grades, mastery, Queue or FSRS.
