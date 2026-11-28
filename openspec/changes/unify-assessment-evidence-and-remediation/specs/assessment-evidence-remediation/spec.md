# Specification: Unified Assessment Evidence and Remediation

## ADDED Requirements

### Requirement: Eight-Purpose Assessment Taxonomy
Assessment blueprints, attempts, and evidence ingestion MUST classify every assessment using one of eight explicit purposes: `diagnostic`, `formative`, `retrieval_practice`, `mastery`, `mock_exam`, `summative_exam`, `practical_skill`, or `self_assessment`. Each purpose MUST enforce deterministic rules for competency dimension weights, exam isolation, hint availability, and mastery eligibility.

#### Scenario: Self-assessment calibrates confidence without inflating mastery
- **GIVEN** a learner completes an assessment with `assessment_purpose = 'self_assessment'`
- **WHEN** `record_evidence_for_grade_tx` processes the completed attempt
- **THEN** the system MUST record confidence/calibration metadata
- **AND** it MUST NOT increase demonstrated `comprehension`, `retention`, `application`, or `transfer` mastery thresholds or qualify a concept as `demonstrated_prior`

#### Scenario: Summative and mock exams enforce strict isolation and answer-key stripping
- **GIVEN** a learner starts an attempt with `assessment_purpose = 'summative_exam'` or `'mock_exam'`
- **WHEN** the attempt payload is delivered to the frontend
- **THEN** answer keys MUST be stripped via `publicQuestion.ts`, hints MUST be disabled, and exam isolation MUST block spoiler assistance until submission

#### Scenario: Model-only policy continues to exclude unverified mastery evidence
- **GIVEN** an assessment blueprint revision carries `knowledgePolicy = 'model-only'`
- **WHEN** a grade is finalized for any `assessment_purpose`
- **THEN** the evidence pipeline MUST exclude the grade from demonstrated competency evidence

---

### Requirement: Transactional Evidence Invalidation and Recomputation
When an exam grade is regraded or manually overridden, or when a question revision is invalidated, the system MUST transactionally mark superseded `learning_evidence` rows with `invalidated_at`, `invalidation_reason`, and `superseded_by_grade_id`, recompute affected concept summaries, 5-dimension competency projections, and knowledge gaps strictly from non-invalidated evidence, and preserve immutable `exam_response_submissions`.

#### Scenario: Regrading a previously failing question clears stale evidence and gaps
- **GIVEN** a finalized grade `G1` marked concept `K` as failed, creating active `learning_evidence` row `E1` and an open `learning_gap` for `K`
- **WHEN** the learner challenges the grade and a manual override or regrade finalizes grade `G2` as passing
- **THEN** within one SQLite transaction, `E1` MUST be marked with `invalidated_at != NULL`, `invalidation_reason = 'manual_override'` or `'regraded'`, and `superseded_by_grade_id = G2`
- **AND** new active evidence `E2` for `G2` MUST be recorded
- **AND** the competency projection and knowledge gap for `K` MUST be recomputed strictly from active evidence, closing the stale gap while keeping the original `exam_response_submissions` row immutable

#### Scenario: Invalidating a faulty question revision removes its mastery distortion
- **GIVEN** question revision `QR1` contributed evidence `E1` to concept `K`
- **WHEN** `QR1` is marked invalidated with `invalidation_reason = 'question_invalidated'`
- **THEN** `E1` MUST be marked invalidated and excluded from `K`'s competency projection recomputation
- **AND** if no other active evidence remains for `K`, `K` MUST revert to `insufficient-evidence` / `unknown`

---

### Requirement: Dimension-Targeted Remediation Routing
Remediation planning MUST route each active knowledge gap to a targeted learning modality matching the failing competency dimension (`retention`/recall, `comprehension`, `application`, `transfer`, or `exposure`) and MUST display a deterministic explanation of why that modality was selected.

#### Scenario: Recall failure routes to spaced retrieval rather than passive re-reading
- **GIVEN** a learner has high `comprehension` on concept `K` but fails delayed recall (`retention` gap)
- **WHEN** the remediation planner generates a remediation recommendation for `K`
- **THEN** the recommendation MUST set `target_dimension = 'retention'` and route to spaced retrieval practice (flashcards / cued recall) with a deterministic rationale

#### Scenario: Comprehension failure routes to grounded reading or Socratic explanation
- **GIVEN** a learner fails a conceptual rubric item indicating a `comprehension` gap on concept `K`
- **WHEN** the remediation planner generates a remediation recommendation for `K`
- **THEN** the recommendation MUST set `target_dimension = 'comprehension'` and route to a source-grounded guided reading re-anchor (or Socratic explanation if allowed by privacy policy)

#### Scenario: Application failure routes to worked examples or practical skill practice
- **GIVEN** a learner demonstrates recall and comprehension on concept `K` but fails an `application` item
- **WHEN** the remediation planner generates a remediation recommendation for `K`
- **THEN** the recommendation MUST set `target_dimension = 'application'` and route to a worked example or rubric-backed practical skill prompt

---

### Requirement: Remediation Anti-Loop Safeguards and Learner Agency
Remediation MUST enforce per-concept attempt caps, deterministic modality escalation, prerequisite inspection, and cooldowns so learners are never trapped in an infinite remediation loop. Learners MUST be able to skip, postpone, or dismiss any remediation at any time.

#### Scenario: Repeated failed remediation escalates modality and stops looping at cap
- **GIVEN** a learner has 2 consecutive unsuccessful remediation attempts on concept `K` in the same modality
- **WHEN** the remediation planner evaluates the next step
- **THEN** it MUST escalate to `escalation_stage = 1` and switch to a different modality
- **AND** after 3 unsuccessful attempts it MUST escalate to `escalation_stage = 2`, surfacing any `alternative_explanation_of` source and checking unmet `requires` prerequisites
- **AND** upon reaching the configured attempt cap (default 4 within 24 hours), it MUST set `cooldown_until`, halt automatic requeuing, and present explicit pause/dismiss/edit options

#### Scenario: Local-only and AI-excluded sources never hit cloud AI during grading or remediation
- **GIVEN** an assessment or remediation references a document marked `is_local_only = true` or `is_ai_excluded = true`
- **WHEN** grading, evidence recomputation, or remediation generation executes
- **THEN** no document content or rubric excerpt from that document MUST be sent to cloud AI endpoints
- **AND** objective grading, manual grading, and local source re-anchoring MUST remain fully functional
