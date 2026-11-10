## Why

Ready assessment artifacts are not useful until learners can actually take them. Plethora needs durable attempts, typed responses, interruption/restart recovery, explicit submission, deterministic objective scoring and history that work offline while strongly separating examination from card review scheduling.

## What Changes

- Add native attempt/current-response/immutable-response-submission/grade-history persistence and typed Tauri APIs with CAS revisions, client mutation ids, start/submission idempotency and explicit cancellation/deletion semantics.
- Implement the durable attempt lifecycle: InProgress → Submitted → Grading/PartiallyGraded → Complete or GradingFailed; InProgress → Cancelled. Draft/Ready remain blueprint states, not attempt states.
- Add pure deterministic scoring for single-select, multi-select exact-set/all-or-nothing, cloze accepted-alternative per-blank credit, blank/skipped responses and accepted-exact short answers; aggregate official scores only when all required items are final.
- Build polished desktop/mobile exam-taking UI with question navigation, typed responses, essay editor, keyboard support, save/resume, skip/revisit, progress, optional durable deadline, submission confirmation, error recovery, accessibility and reduced-motion behavior.
- Add basic Practice mode with immediate post-Check feedback and repeated response submissions; exam/diagnostic mode withholds hints/correctness until final submit. Full adaptive hints/tutor behavior belongs to Change 7.
- Add objective results, pending-subjective states and attempt history. Exam questions/grades never become learning items or alter FSRS ratings, review timing, Queue priority or membership.

## Capabilities

### New Capabilities

- `exam-sessions`: Durable fixed-paper attempts, offline responses/resume/timers/submission, objective and practice scoring policy, results/history and interruption/failure recovery.

### Modified Capabilities

None. This change adds exam-session behavior without changing existing answer-assessment or curriculum contracts.

## Impact

- **Frontend:** new pure scorer, attempt API/service/hooks and runner/results/history components under Study Plans.
- **Native:** fresh-numbered attempt/response/submission/grade migration, committed-history deletion guard, repositories/models/commands.
- **Reuse:** C3 Ready fixed revisions/public question projections, C1 source navigation, existing review interaction references only where semantics fit. C2 job API not needed for deterministic scoring.
- **Privacy/scheduling:** all taking/objective grading works offline after Ready; no provider call, existing `submitReview` change, scheduled exam item or automatic queue/card creation.
