## Why

Persisted plans, exams and explainable gaps still need a smooth response to weakness: optionally diagnose before finalizing a plan, study through the existing tutor with the topic's actual source context, practice with progressive support, create optional cards through approval, and reassess without rebuilding context. This change completes the learning loop instead of adding disconnected AI buttons.

## What Changes

- Add an optional diagnostic branch to the Study Plan workflow using the existing assessment blueprint/generation/attempt/grading/evidence stack. Default 6, bounded 4–12 items; Skip is immediate and leaves no attempt/evidence. A diagnostic tailors only a reviewable curriculum draft and never auto-completes/skips topics.
- Extend the existing TutorSheet host with bounded Study topic/objective/misconception/evidence context and injected retrieval constrained by validated sourceDocumentIds; preserve its current state machine and non-Study host behavior.
- Enable precommitted progressive hints only for Practice, record hintLevel on checked submissions, provide guided tutor escalation, and derive the next targeted practice difficulty/source/repeat exclusions deterministically after Finish.
- Reuse existing Learn This preview/edit/accept for optional flashcard proposals with stable acceptance ids; rejected proposals do nothing and accepted cards intentionally enter ordinary review workflows without an exam score becoming an FSRS rating.
- Add weak-topic follow-up exam, same-paper retake/new-paper choice and diagnostic/evidence-driven plan draft adaptation, all with source/prerequisite integrity, explicit user approval and offline/resume behavior.

## Capabilities

### New Capabilities

None. Diagnostics/practice belong to Study Plans; source-scoped tutoring extends its existing owner.

### Modified Capabilities

- `adaptive-learning-paths`: Add optional diagnostic initiation/completion/skip/adaptation and deterministic targeted practice/reassessment integration.
- `ai-socratic-tutoring`: Add source-scoped curriculum/gap tutor launch and explicit separation between tutoring dialogue and assessed learning evidence.
- `knowledge-gap-detection`: Complete the existing concrete remediation action contract with working source/tutor/practice/card/follow-up entry points and preserved dispositions.

## Impact

- **Frontend:** new diagnostic/practice/tutor/card adapters and Study Plans workflow components; narrow modifications to C1/C2 wizard, C3 builder/C4 runner, TutorSheet and Learn This preview/acceptance.
- **Native:** no new tables planned. Add only a read-only diagnostic-evidence adapter command; practice hints use the C4 response-submission `hint_level` field and shared fixed-paper modes.
- **Privacy/review:** new inference uses C2 preflight/explicit provider consent; saved objective/manual workflows remain offline. Tutor conversation alone is not mastery evidence. Existing tutor policy/card acceptance/FSRS semantics remain authoritative.
