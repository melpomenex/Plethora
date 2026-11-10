## Purpose

Lets learners complete fixed assessments with durable typed responses, dependable restart/mobile recovery, deterministic objective scoring and inspectable history while preserving the distinct purposes of practice, examination and existing user-controlled FSRS scheduling.

## ADDED Requirements

### Requirement: Attempts start only from valid committed fixed papers

The system SHALL create an attempt only from a Ready blueprint revision whose question keys/rubrics/source and quota/shortfall requirements are satisfied. Start SHALL atomically persist the attempt, ordered pinned question revision ids, typed response slots, maximum points, mode and optional deadline. Public question payloads SHALL omit private answers before submission. Timer-free attempts SHALL be the default.

#### Scenario: Start prepares a recoverable paper

- **WHEN** a learner starts a Ready mixed-format paper
- **THEN** exactly one attempt with the same ordered question revisions and empty typed responses is committed and its public questions contain no committed key/reference solution

#### Scenario: Invalid paper cannot start

- **WHEN** a blueprint is Draft, Needs Review, has a stale/missing required source, an uncommitted/invalid question or an unaccepted shortfall
- **THEN** Start returns the appropriate validation/quota error and creates no attempt or empty response rows

#### Scenario: Start retry is idempotent

- **WHEN** the same blueprint revision and client-start key are admitted twice after an uncertain response
- **THEN** the original attempt is returned and no duplicate attempt or response set is created

### Requirement: Confirmed responses are durable and independently saved from grading

The system SHALL persist each validated current response before confirming Save in the UI. Save SHALL use response revision CAS and a client mutation id, validate response kind/options/blanks/text against the pinned question, and not require a provider/network. Skip, unanswered and answered SHALL remain distinct marks; navigating questions SHALL NOT lose a previously confirmed response.

#### Scenario: Restart during examination

- **WHEN** a learner answers several questions, acknowledges their saves and closes/restarts the application
- **THEN** the same InProgress attempt reopens with all confirmed responses/marks/order restored and no duplicate attempt is created

#### Scenario: Storage failure is visible

- **WHEN** a response write fails or times out without reconciliation
- **THEN** the editor does not claim the response is saved, retains the current local draft for retry where possible, and never treats it as submitted evidence

#### Scenario: Idempotent save replay

- **WHEN** the same response mutation id and identical canonical payload are retried
- **THEN** the saved response is returned without incrementing revision; reusing that id for a different payload is rejected

#### Scenario: Malformed response is refused

- **WHEN** a response has the wrong discriminant, unknown/duplicate option ids, unknown blanks or exceeds its text bounds
- **THEN** Save fails field-specific validation and the previous persisted response remains current

### Requirement: Attempt lifecycle and concurrent operations are explicit

Attempt status SHALL be exactly InProgress, Submitted, Grading, PartiallyGraded, Complete, GradingFailed or Cancelled. Save/Skip/Navigate are valid only in InProgress (apart from read-only review); Submit/Timer moves InProgress to Submitted and then grading status derives from persisted item states; no state returns to InProgress after submission. Cancellation is valid only before submission and preserves read-only answers without grading evidence. CAS revisions and idempotency keys SHALL protect simultaneous UI writes/submission.

#### Scenario: Double submission creates one paper settlement

- **WHEN** two concurrent submit actions target the same attempt
- **THEN** one transaction creates one final response submission per response and one applicable grade sequence, while the other action receives the current result without duplicate records

#### Scenario: Retry with same submission key reconciles

- **WHEN** submission is retried with the same attempt/idempotency key after a lost response
- **THEN** the original submission snapshot and current status are returned without changing score/history

#### Scenario: Cancelled attempt does not become evidence

- **WHEN** a learner cancels an InProgress attempt
- **THEN** its confirmed draft responses remain visible as abandoned/cancelled history but it cannot Resume/Submit and no attempt grade, learning evidence, Queue or FSRS update is generated

### Requirement: Optional timers use durable wall-clock deadlines

A timed exam SHALL persist `deadlineAt` at Start, continue elapsed time across navigation, restart and mobile suspension, and derive the visible timer from that deadline rather than interval-write counts. Expiration SHALL submit the last confirmed responses exactly once, including `timer-recovered` reconciliation on next open if the app was closed/suspended. Practice SHALL have no deadline. The UI SHALL disclose this behavior before Start and SHALL NOT claim unacknowledged keystrokes were saved.

#### Scenario: Application reopens after deadline

- **WHEN** a timed attempt's deadline elapsed while the application was closed
- **THEN** reopening transitions it once using timer-recovered, submits saved responses and enters the appropriate deterministic/grading state without a duplicate attempt

#### Scenario: Suspension flush does not pause time

- **WHEN** mobile suspension follows a lifecycle response flush
- **THEN** confirmed work is restored on resume and remaining time is computed from the original deadline

#### Scenario: Untimed default

- **WHEN** no time limit is configured
- **THEN** no deadline is created and restart/suspension never auto-submits the attempt for elapsed time

### Requirement: Objective scoring is deterministic, exact and testable

Objective scoring SHALL use pure application logic over a committed question and typed submitted response without an AI model. Single-select SHALL award max points only for the matching option. Multi-select SHALL use all-or-nothing exact-set equality with no partial credit or negative marking. Cloze SHALL normalize NFKC/trim/whitespace/case according to committed blank policy, accept only exact alternatives and distribute equal per-blank partial credit. Unanswered/skipped items SHALL earn zero with distinct outcomes. A nonblank accepted-exact short answer MAY earn full deterministic credit; other nonblank short/essay items SHALL remain pending rather than being marked wrong by string mismatch.

#### Scenario: Multi-select partial selection earns zero

- **WHEN** correct ids are A,C and the learner selects only A or A,C,B
- **THEN** both responses score zero, while exactly A,C earns max points regardless of display/selection order

#### Scenario: Cloze earns explainable partial credit

- **WHEN** a 10-point cloze has four blanks and the learner correctly answers two using accepted case/whitespace alternatives
- **THEN** it earns five points and Partial; no fuzzy punctuation-stripping heuristic changes a nonmatching answer to correct

#### Scenario: Unanswered numeric outcome is distinct

- **WHEN** an item is skipped and another was never answered
- **THEN** both receive zero under scoring policy but their results separately show Skipped and Unanswered without model feedback

#### Scenario: Subjective paraphrase is not auto-wrong

- **WHEN** a nonblank short answer does not exactly match accepted alternatives and no grader has run
- **THEN** it has nil official item points/pending state rather than zero based only on text mismatch

### Requirement: Submission atomically preserves immutable answers and objective results

Submission SHALL create immutable typed response submissions from current responses, persist objective grades, and calculate attempt status in one transaction. Grading retries/subsequent subjective results SHALL reference a response submission and pinned question/key/rubric revision, never overwrite the learner's response. Official aggregate points SHALL remain null until every required item has a final grade; a labelled provisional objective subtotal MAY be displayed separately.

#### Scenario: Fully objective paper completes offline

- **WHEN** a learner submits only valid single/multi/cloze/blank items
- **THEN** objective results, total/max score and per-item explanations/citations are committed and shown without inference

#### Scenario: Mixed paper is not prematurely complete

- **WHEN** objective items are scored but a nonblank essay still needs rubric grading
- **THEN** the attempt shows PartiallyGraded/Grading with objective evidence available and null official overall total until essay resolution

#### Scenario: Database failure rolls back settlement

- **WHEN** any final submission/objective grade cannot be written
- **THEN** the submission transaction rolls back and the prior InProgress attempt/confirmed drafts remain retryable rather than appearing partially submitted

### Requirement: Practice and examination share schemas but differ in feedback policy

Question/response/rubric schemas SHALL be shared across modes. Examination and diagnostic mode SHALL provide no hints, correctness/explanation/reference answer before final submission and one final response submission per response. Practice SHALL permit immediate post-Check feedback, stable committed explanations/references, and repeated ordinal response submissions while remaining InProgress. Neither mode SHALL mutate a fixed question after an attempt starts.

#### Scenario: Practice retry creates a new round

- **WHEN** a learner receives deterministic feedback and checks a revised response
- **THEN** a new ordinal practice-check submission and grade are appended while the earlier checked answer remains inspectable

#### Scenario: Practice Finish does not duplicate an unchanged Check

- **WHEN** a learner has checked a practice response with a given payload/mark/hintLevel and selects Finish without changing it
- **THEN** Submit reuses that latest ordinal practice-check and creates no duplicate grade/evidence, while a changed payload/mark/hintLevel appends exactly one next ordinal before terminal status derives

#### Scenario: Exam cannot leak practice feedback

- **WHEN** a learner navigates/saves an exam response before final Submit
- **THEN** no correctness, committed answer, explanation, hint or tutor action is exposed through the attempt UI

### Requirement: Results and history remain local and source-linked

The system SHALL retain final/cancelled/failed attempt history, per-question responses/outcomes/points, committed revision ids, grading/progress states, total/max when final, timestamps and current source citations. Results SHALL allow navigation to current sources and disclose stale/missing evidence. History SHALL survive restart/offline use and distinguish same-paper retakes by blueprint revision. Unavailable subjective grades SHALL be clearly pending/failed, never fabricated.

#### Scenario: Attempt history restores after restart

- **WHEN** a learner reopens Study Plans after completing an objective paper
- **THEN** the same report, source links, per-item outcomes and exact final/max points appear without provider access

#### Scenario: Older paper follows question correction

- **WHEN** a question/key is edited in a new blueprint revision after an attempt
- **THEN** the historical attempt/report continue using their original question revision, and starting/editing the new revision does not rewrite old answers or scores

#### Scenario: Source deletion preserves report

- **WHEN** the cited document is later deleted
- **THEN** the report/answers/grades stay readable with stored evidence and Missing Source status rather than cascading away

### Requirement: Examination evidence cannot commandeer Review, Queue or FSRS

Exam questions, responses and grades SHALL use exam-owned tables with no learning-item scheduling ownership. Attempt generation/taking/scoring/evidence hooks SHALL NOT call review-rating submission, assign FSRS grades, change due dates/intervals/memory state/lapses, Queue membership/order or user priority. Subsequent optional card creation SHALL use only an existing explicit proposal/acceptance surface outside this change.

#### Scenario: Objective exam leaves scheduler unchanged

- **WHEN** an exam is created, started, answered, submitted and deterministically graded
- **THEN** existing Review call traces, learning-item scheduling fields, FSRS-7 state, DAQE ordering and Queue priorities are unchanged

### Requirement: Taking and reviewing assessments are accessible and responsive

Attempt navigation, all five response types, progress, save/error state, skip/submit, results and source/remediation actions SHALL be keyboard/screen-reader operable and usable at supported mobile widths without hover dependence. Motion SHALL respect reduced-motion preference and timer/loading changes SHALL use appropriately non-disruptive announcements. Long-form editors SHALL preserve text while navigation/recovery occurs and provide persistent save/error status.

#### Scenario: Keyboard completes an objective exam

- **WHEN** a user relies on keyboard navigation and visible focus
- **THEN** they can select choices, fill every blank, answer long form, move/revisit/skip, submit and inspect results without pointer-only controls

#### Scenario: Reduced-motion mobile recovery

- **WHEN** a reduced-motion mobile-width user backgrounds/resumes the app
- **THEN** content restores without required animation, focus is placed on the resumed question/status and save/deadline discrepancies are announced without abrupt modal stacking
