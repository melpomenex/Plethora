## Context

C4 stores immutable response submissions and deterministic grade history. Existing `AnswerAssessment` is fail-closed (numbers out of range are rejected) and `assess-answer` supplies containment, reasoning/full routing and review semantics. Its schema should remain intact, including the native Kotlin structured-output schema. Its default targetId omits exam identity/expected answer/source, and its review persistence is fire-and-forget, so neither can directly own exam grading.

Normative references: program `02-SHARED-CONTRACTS.md` §§5–7/9–13; C2 job contracts; C4 attempts; ADR-13/14/20.

## Goals / Non-Goals

**Goals:**

- Source-bound, criterion-level structured short/essay grading with deterministic points.
- Fully recoverable mixed attempts and provider/model/fallback provenance.
- Explainable limitations and auditable user correction/manual finalization.
- Exact current-grade/evidence-ready semantics, no scheduler side effects.

**Non-Goals:**

- Changing `AnswerAssessment` native/review schema or using `answer_assessments` for exam rows.
- Claiming calibrated confidence, infallible semantic evaluation or anti-cheat security.
- Generating new answers/rubrics after seeing learner responses, modifying fixed papers, automatic regrade of manual grades.
- Gap rules (C6), hints/tutor/diagnostic creation (C7).

## Decisions

### Composed task/output schema

New `rubricAssessment.ts` imports `AnswerAssessment` and `validateAnswerAssessment` unchanged. `study-rubric-grade`/`study-rubric-grade-full` are new task twins in their own definition module. Input:
`{attemptId,responseSubmissionId,questionRevisionId,question,committedAnswer,rubric,validatedSources,learnerResponse}` plus immutable metadata. Output is `RubricGradeProposal` shared §6. `taskType=prompt`, structured, `requirement=prompt`, max1600 output, timeout90s. Each input block is separately untrusted; instruction explicitly grades data, never follows directives from source/learner/model-generated rubric as executable instructions.

The existing `assess-answer` module remains the semantic reference and provider-routing precedent; do not use its default targetId blindly. Short answers also use the rubric task because committed criteria and deterministic application aggregation must apply uniformly to every non-exact short answer. For directly accepted exact alternatives, C4 already supplies deterministic Final and no job step exists.

### Validator/aggregation

`validateRubricGradeProposal` first validates the existing AnswerAssessment envelope, then exact criterion ids, one-per-id, levels/statuses, response substring/allowed source handles, missing-concept and text bounds, and limitations. Any structural error fails task output, allowing only runTask's existing single repair. A criterion marked not-assessable is structurally valid but makes its question Needs Review and official points null. Nonblank response missing source needed for grading fails before task run.

`aggregateRubric` uses full precision and criterion weights; `score`/`completeness` in overall model output are ignored for official points. `classification-mismatch` applies the coarse shared consistency tripwires: overall correct with normalized<0.75 or overall incorrect with normalized>0.25. The tripwire creates Needs Review, not adjusted points. Non-reasoning essay fallback also produces Needs Review; the user may confirm/correct through Manual Review, creating a Manual current row with the same reasoning and provenance link in history.

`CriterionResult` permits manual criterion levels/notes without requiring fake learner-evidence quotes. Manual grade may leave `assessment=null`; UI derives outcome from official points and displays the required manual reason. The user must provide all criteria exactly once, levels and nonempty `manualReason`, expectedAttemptRevision and target response submission. Optional manual response feedback is bounded but is not assigned model confidence.

### Jobs and state transitions

After C4 Submit, collect all nonblank subjective response submissions lacking a final exact deterministic grade. Create C2 `exam-grading` job with one `grade:<responseSubmissionId>` step per response and a fresh caller UUID creation key. The job target is attempt/current revision; request hash covers each response/question/key/rubric revision and source hashes. Planned inputs persist before any provider call.

Coordinator claims one step, checks privacy/source now, runs rubric task, validates, computes points/status and calls the C2 completion command with a typed grading artifact. The native completion transaction executes the internal rubric-grade insert, sets previous AI current row not current if this job is an authorized regrade, writes current result+attempt status/subtotal, marks step and releases lease. It never separately calls both generic completion and `record_rubric_grade` for the same result. Exposed `record_rubric_grade` wraps that same internal transaction when a direct legacy/test adapter is necessary; normal production coordinator uses Complete Step only.

Only a failed/not-yet-graded step is eligible for in-job Retry. A valid grade needing manual review leaves job Awaiting Review. Intentional regrade starts a new job/creation key over the same immutable identities. If current grade is Manual, automatic job commit leaves new AI result noncurrent and Awaiting Review rather than changing report/evidence. Grades are append-only with supersedes id, not mutated content. `exam_grades.is_current` unique partial index prevents two current rows.

Attempt status after each commit: all final→Complete (official total/summary); at least one failed and none in-flight/pending→GradingFailed; at least one final/needs-review alongside pending→PartiallyGraded; otherwise Grading. Needs Review official total remains null until finalized manually. Provider declined/no provider before inference leaves a failed/interrupted job step with no fabricated grade row. If inference was attempted and then timed out/refused/invalidated, failure settlement MAY append an `origin=ai,state=failed,points=null` grade with safe provenance through the same failed-step transaction. It becomes current only when no prior current Final/Manual result exists; otherwise it is historical and the prior valid result remains authoritative. Every failed/pending condition leaves official total unresolved unless a prior current complete paper result remains deliberately unchanged by an explicit regrade. Retry appends/supersedes history and never emits evidence from a failed row. No silent destination change occurs; existing saved results remain available.

### Result UI and correction

C4 result components are extended, not duplicated: criterion weights/level contributions, model overall feedback/missing/misconception, exact response quote, source links, provenance/limitations, history/diff, Retry and Review. Needs Review and GradingFailed have targeted recovery actions. Manual Review form renders every criterion with level radio 0–4, neutral descriptors from committed rubric and correction reason; confirmation performs one CAS command and refreshes aggregate/history. Automatic inference never fires merely from viewing results.

### Evidence-ready boundary

C5 exposes an internal settlement result listing affected `(responseSubmissionId,questionRevisionId,gradeId,origin)` records; C6 will subscribe within the native transaction/command extension to append/update learning evidence. C5 itself does not create its own `learning_evidence` or mastery state. All final and adjusted grades preserve objective provenance. C6's implementation task must rebaseline this transaction without copying C5 grade logic.

## Risks / Trade-offs

- **Model misjudgment remains possible even when valid** → criteria/evidence/provenance/manual correction and real-model evaluation; no certainty claim.
- **Non-reasoning essay grading cost/latency** → needs-review instead of automatic final and per-item jobs rather than giant call.
- **Duplicate grade/provider execution** → at-least-once tasks plus unique job steps, current-grade CAS and immutable response submission; no exactly-once billing claim.
- **Holistic/criterion contradiction** → flag for manual review; never silently force consistency by mutating output.
- **Extra intervention for ambiguous grades** → intentional educational safety; quick manual form computes exact score from committed weights.

## Migration Plan

No routine migration: C2 job tables and C4 complete schema were specified for this change. If real query performance proves a new index necessary, append a separate fresh-numbered migration with tests; never modify C3/C4 SQL history. No changes to existing review assessment records or native schemas. Rollback retains grade history; old application builds must not overwrite newer JSON payloads.
