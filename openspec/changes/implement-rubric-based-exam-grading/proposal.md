## Why

Objective exam results work after Change 4, but non-exact short answers, essays and multi-step explanations require source-grounded semantic evaluation. A model's holistic 0–100 score, self-reported confidence or post-hoc re authored answer would not be sufficiently transparent or auditable; Plethora needs committed criteria and deterministic score aggregation.

## What Changes

- Compose the canonical `AnswerAssessment` envelope with a new fail-closed per-criterion rubric-evaluation contract; leave its existing native/review wire schema unchanged.
- Add contained reasoning/full rubric-grading tasks for short answers and essays over the pinned question, committed reference/key facts/rubric, validated evidence and immutable learner response.
- Grade each criterion independently on committed levels 0–4; require exact learner-answer evidence and allowed source handles; calculate final points from weights/levels in application logic.
- Drive pending/failed/partial/mixed-attempt grading through Change 2's durable jobs and Change 4's response submissions, with bounded retries, cancellation/resume and criterion-level manual review.
- Preserve AI grading history/provenance and provider limitations; ambiguous, contradictory, not-assessable and non-reasoning essay fallback results require review instead of silently becoming final.
- Add user grade challenge/manual correction with full audit history, deterministic attempt aggregate updates and evidence-ready settlement hooks. No exam result changes FSRS ratings or Queue state.

## Capabilities

### New Capabilities

None. Rubric-based free-response grading extends the existing answer-assessment owner rather than creating a parallel assessment envelope.

### Modified Capabilities

- `ai-answer-assessment`: Add committed analytic rubric evaluation, deterministic criterion aggregation, exam-attempt/source binding, safe degradation, manual correction and retry/history while preserving scheduler authority.

## Impact

- **Frontend:** new rubric schema/aggregation/task/coordinator modules and result/manual-review components; existing `answerAssessment.ts` is imported unchanged.
- **Native:** reuse C4 `exam_grades`/response submissions and C2 job ledger; new grading coordinator/commands only, with no routine migration expected.
- **Privacy/reliability:** submitted answers/reference/rubrics are disclosed only through authorized routes; failed inference never deletes/deterministically misgrades saved answers. No silent cloud fallback.
- **Boundaries:** C5 does not create learning gaps itself; it supplies final/current grade settlement and provenance to C6. Active card-quality files and native Kotlin `AnswerAssessment` schema remain untouched.
