## Context

C3 provides committed Ready revisions and public question projections. The reusable review interaction functions contain exact/fuzzy/order/matching helpers, but their punctuation-stripping/fuzzy semantics are not appropriate for all exam items. No durable attempts exist. Exam grades must not enter the review-owned `answer_assessments` table.

Normative contracts: program `02-SHARED-CONTRACTS.md` §§5–7/11–13; `04-DATA-AND-MIGRATION-PLAN.md` §6; ADR-11/12/14/15/21–22.

## Goals / Non-Goals

**Goals:**

- Durable fixed-paper attempt state, typed responses, CAS/idempotency and offline objective reports.
- Deterministic scoring with pure domain fixtures and mixed-paper pending semantics.
- Native responsive runner, lifecycle recovery, deadline behavior and history.
- Basic shared Practice Check repetition without changing exam schemas.

**Non-Goals:**

- Non-exact AI grading/rubric task/orchestration (C5), gaps/evidence analysis (C6), tutor/adaptive hints (C7).
- Adaptive exam item replacement, psychometric adaptive testing, auto FSRS rating/queue composition.
- PWA storage implementation, secure anti-cheat answer storage, device-clock tamper resistance.

## Decisions

### Pure scoring and transaction interface

`gradeObjective(question,response,mark)` returns `{eligible, outcome, points,maxPoints,criteria:[],assessment?}`; `eligible` means deterministic final/blank grade vs requires subjective grading. Public Report DTO never exposes model-private keys until the applicable reveal policy permits. `submit_exam_attempt` receives the objective grade array produced by this pure function plus attempt CAS/submission key. Rust revalidates attempt membership, question revision, points bounds, one-submission-per-item and current state before transaction. It needlessly reimplementing scoring in Rust is avoided; shared golden vectors lock TS behavior and native persistence checks reject out-of-range/mismatched values.

Short accepted-exact response uses the same objective grader; non-exact nonblank short/essay has no grade written until C5. Blank/skipped short/essay receives final deterministic zero. Aggregate derives from current final grades, not from provider scores. The official total stays null for any needs-review/failed/missing subjective item.

### Attempt ownership and CAS

Use C4 DDL unchanged: Last client mutation id is unique within an attempt; current response CAS protects concurrent autosave/blur. Start client key prevents duplicate attempts. Submit key plus one-exam-final index protects duplicate/double submits. Submit transaction writes response snapshots, grades and final status/total. Background objective grade writes do not call provider or review APIs.

`submitted` is allowed as a persisted intermediate if app stops before grading transition; recovery derives from current grade rows. Objective-only submission normally reaches Complete in the same commit. Subjective papers enter Grading or PartiallyGraded. C5 drives subsequent transitions. Cancelled never gets final response submissions merely due to cancellation.

### Response/save lifecycle

Start inserts all response rows with empty typed variants/unanswered marks. Local `AttemptController` tracks current index and raw editor input; save debounce 300ms plus explicit navigation/blur/page visibility/mobile lifecycle flush. It validates locally then invokes Save; only the returned revision is confirmed. Unknown command response is stale and should be reconciled by `get_exam_attempt` before retry; same client mutation id makes retry safe.

Exam final submission uses latest confirmed drafts. To prevent currently debounced valid edits being silently omitted, Submit first flushes the active editor and waits for its ack; if that save fails, Submit does not proceed. The same reconcile behavior runs on lifecycle expiration; if write is impossible, only previously confirmed persisted state can be recovered when storage returns.

### Timer

Optional deadline is Rust UTC start + configured seconds. Timer UI computes remaining from `now()` and only display updates each second; no DB write per second. Timer warns 5min/1min where applicable without aggressive modal interruptions. If current process observes zero, submit after flush; on startup/open any InProgress whose deadline≤now invokes Submit timer-recovered once using a deterministic submission key (`timer:<attemptId>`), so duplicate recovery is safe. Practice nulls deadline. System clock control remains local user trust, not security against tampering.

### Mode policy

`AttemptModePolicy` is pure configuration: Exam/Diagnostic `allowCheck=false`, `revealBeforeSubmit=false`, `allowHints=false`, one final submission. Practice `allowCheck=true`, immediate reveal, repeated submissions; it has no timer and Start remains InProgress until explicit Finish (Submit) or Cancel. Practice checks objective items and exact short answers in C4; subjective non-exact entries wait for C5, showing Pending rather than false feedback. Repeated submissions are ordinal, immutable and never replace previous history. Practice Finish uses normal Submit after a flush: reuse the latest practice-check only when canonical payload, mark and hintLevel are identical; otherwise append the next practice-check ordinal before deriving terminal/grading state. A repeated Finish/submission key is idempotent and unchanged checked work produces no duplicate evidence. exam-final uniqueness does not apply to these practice-check ordinals. C7 adds hint/adaptive/tutor behavior using the C4 hintLevel=0 baseline.

### UI

One Study Plans nested Runner screen replaces the editor while an attempt is active; it does not enter Review. Desktop uses sidebar/list question map and main response area; narrow/mobile uses collapsible question map + sticky save/progress controls, while keeping keyboard/screen-reader semantics. Persist draft text between question selection and only display Save confirmation after commit. Submission uses one inline confirmation summary (not stacked dialogs). Results use per-question ordered list, official/pending labels and citations; no mastery percentages or gap recommendations until C6.

### C4 schema guard for committed history

The C4 migration adds a `BEFORE DELETE` trigger on committed question revisions when any `exam_responses` references `OLD.id`, raising `committed_question_immutable`. C3's unused-blueprint hard delete remains possible before any attempt; attempted fixed papers cannot be deleted/cascade away. Native history deletion is only by attempt id and leaves paper revisions available for comparison.

## Risks / Trade-offs

- **Trusted TS grader output in native command** → Rust checks structural ownership/ranges and golden vectors; no adversarial local security claim.
- **Uncertain save at Submit** → always flush/reconcile before Submit and show storage failure; durable work is only acknowledged work.
- **Timer running suspended** → explicit disclosure and deterministic deadline recovery; no paused-time ambiguity.
- **Full grade schema introduced before C5** → avoids destructive/repeated migrations but C4 writes deterministic rows only.
- **Practice history grows** → bounded exam 40 items + UI repeat confirmation and indexed ordinal queries; full adaptive limits arrive C7.

## Migration Plan

After C3 gate append C4 migration including committed-history delete guard. Repositories/commands/wrapper then pure runner/scoring can integrate. No existing rows migrate. No roll-back rewrite; older builds ignore new tables but must not receive synthetic success through browser backend. Existing review tests are a required gate.
