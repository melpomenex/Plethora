## ADDED Requirements

### Requirement: Diagnostic assessment is optional and reuses the examination engine

A user finalizing a generated Study Plan draft MAY choose Take Diagnostic or Skip. A diagnostic SHALL use an ordinary blueprint revision and attempt with `mode=diagnostic`, shared questions/committed keys/rubrics/grading/evidence, 4–12 items (default 6), selected source scope and no timer/hints/pre-submit correctness feedback. Diagnostic question kinds SHALL be limited to single-select, multi-select, cloze and short-answer; no separate diagnostic storage/engine or mandatory essay is introduced. Skip SHALL proceed without inference, an empty attempt, or learning evidence. Diagnostic completion SHALL require all needed response grades to be Final or explicitly manually finalized.

#### Scenario: User skips without side effects

- **WHEN** a user chooses Skip before diagnostic generation
- **THEN** normal curriculum preview/publication remains available and no diagnostic job/paper/attempt/evidence is created

#### Scenario: User completes a diagnostic

- **WHEN** a valid six-item diagnostic is answered, submitted and all needed deterministic/AI/manual grades are Final
- **THEN** its results are tied to the provisional plan version/source scope and visible before the user chooses whether to apply them to the curriculum

#### Scenario: Diagnostic grading is pending

- **WHEN** a submitted short answer lacks a provider and has no manual finalization
- **THEN** Apply Diagnostic Results is unavailable with an explicit pending/manual action, while curriculum preview/published existing versions remain intact

#### Scenario: Diagnostic interruption resumes normally

- **WHEN** the application closes during a diagnostic
- **THEN** opening Resume uses the same attempt, typed saved answers and fixed question revisions as every other assessment

### Requirement: Diagnostic evidence tailors only a reviewable plan draft

A completed diagnostic SHALL be convertible by Change 7's read-only adapter into the shared curriculum-prior-evidence contract only when attempt identity/mode, source scope and final results validate. Applying it SHALL produce a new Draft/diff preserving locks/user edits/removals and prerequisite validity. No diagnostic outcome SHALL directly publish a plan, remove/complete topics, create/delete global concept links or assert certain mastery.

#### Scenario: Weak diagnostic topic receives earlier review preference

- **WHEN** diagnostic observed performance for a currently available unlocked prerequisite is below 0.6
- **THEN** deterministic preference places that prerequisite ahead of nonweak available peers without violating DAG prerequisites, and the draft explains the evidence

#### Scenario: Strong performance does not auto-skip

- **WHEN** an item/topic scores above 0.8 on one diagnostic
- **THEN** the topic remains Included with independent evidence limitations and is not automatically marked Completed, Skipped or removed

#### Scenario: Invalid scope cannot adapt plan

- **WHEN** diagnostic source scope differs from the plan draft or the attempt is incomplete/cancelled
- **THEN** the adapter returns invalid-input/invalid-state and no plan draft/version changes

### Requirement: Weak topics launch coherent source-grounded study and reassessment

From a Study Plan node, result or active gap, the user SHALL be able to open current source material, launch scoped tutoring, create a targeted Practice/Follow-up Exam draft, optionally review card proposals, dismiss the recommendation and return to the same topic. Practice/reassessment SHALL preserve source/concept/objective/misconception context and target ids through navigation without requiring the user to reselect them.

#### Scenario: Weak topic to practice and back

- **WHEN** a user selects Practice on a weak topic, completes/checks it and returns
- **THEN** the same Study Plan/result/gap context is restored and the new Practice evidence is visible with its own grader/hints/repetition limitations

#### Scenario: Follow-up offers meaningful retake choices

- **WHEN** a learner selects Reassess
- **THEN** the UI offers Retake Same Paper for directly comparable fixed-revision history or New Source-Grounded Paper excluding prior fingerprints for a fresh measurement, with the tradeoff shown

#### Scenario: Unknown/missing source narrows actions

- **WHEN** topic source refs are missing/stale/ambiguous
- **THEN** source/tutor/generation actions identify their limits and do not retrieve globally or fabricate fresh current grounding

### Requirement: Practice assistance is committed, progressive and separated from exams

Practice questions MAY commit zero to three source-grounded hints before an attempt begins. Only Practice SHALL offer progressive hint reveal, immediate Check feedback, repeated submissions and guided tutor escalation; Exam/Diagnostic SHALL expose none of those aids before final submission. Each Practice checked response SHALL record the highest hint level used (0–3), and its prior-checked answers/history SHALL remain intact. Hints and tutor dialog SHALL NOT silently rewrite the answer key/rubric or count as independent assessment evidence by themselves.

#### Scenario: Hint use is progressive and recorded

- **WHEN** a Practice learner reveals two hints and then checks a response
- **THEN** only hints 1–2 are revealed in order and the immutable checked submission carries hintLevel 2 for evidence weighting

#### Scenario: Exam hides the same stored hints

- **WHEN** an equivalent committed revision is taken in Exam mode
- **THEN** no hint control or content is exposed before Submit regardless of practice hint availability

#### Scenario: Next practice difficulty changes only between papers

- **WHEN** a final latest practice group is below 0.6, above 0.85 without hints, or otherwise
- **THEN** the next user-created practice blueprint respectively decreases difficulty one level to a minimum 1, increases one to maximum 5, or keeps the current level; the active fixed practice attempt never changes questions

### Requirement: Flashcard remediation uses explicit proposal acceptance

Make Cards SHALL open the existing Learn This proposal/edit/accept surface with bounded weak-topic source passages, validated candidates and stable acceptance/proposal idempotency. Closing/rejecting/editing-without-accepting SHALL create no cards. Accepted candidates SHALL pass ordinary source/duplicate/domain validation and only then become existing scheduled learning items. Exam correctness, AI confidence, gap state and tutor output SHALL NOT submit a rating or schedule them automatically.

#### Scenario: Accepted remediation cards are ordinary approved cards

- **WHEN** a user explicitly accepts one or more reviewed candidates
- **THEN** normal learning-item creation/provenance runs once per candidate with stable acceptance ids and those cards enter ordinary Review under user-controlled scheduling

#### Scenario: Rejected proposal changes nothing

- **WHEN** a user dismisses/closes the proposal without accepting
- **THEN** no learning_items, FSRS scheduling, Queue membership/order/priority or review result is created

#### Scenario: Acceptance retry does not duplicate cards

- **WHEN** an acknowledged-card response is lost and the same remediation candidate acceptance is retried
- **THEN** per-candidate acceptance/proposal identity returns/reconciles existing cards rather than creating duplicates
