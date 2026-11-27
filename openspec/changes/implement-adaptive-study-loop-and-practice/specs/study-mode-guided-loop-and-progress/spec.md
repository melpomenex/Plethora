# Study Mode Guided Loop and Progress Specification

## ADDED Requirements

### Requirement: Interchangeable Freeform and Guided Study Modes
Freeform studying SHALL remain the default mode with zero upfront setup, while learners can start or exit a structured Guided Session at any time following the 6-stage adaptive loop: Introduce → Anchor → Understand → Recall & Apply → Adapt → Reinforce → Recap.

#### Scenario: Guided loop adapts on needs-practice outcome
- **GIVEN** a learner is in the `recall` stage of a Guided Session
- **WHEN** the learner submits an answer graded as `needs_review` or `partial`
- **THEN** the loop transitions to `adapt` offering a different explanation/worked example and reassessment before advancing to `reinforce`.

#### Scenario: Guided loop advances on understood outcome and offers optional FSRS promotion
- **GIVEN** a learner is in the `recall` stage of a Guided Session
- **WHEN** the learner submits an answer graded as `understood`
- **THEN** the loop advances to `reinforce` with an optional one-click flashcard creation action (never mutating FSRS automatically) and proceeds to the session `recap`.

### Requirement: Unified Evidence-Based Progress View
The `Progress` tab SHALL compute and display **Exposure**, **Understanding**, and **Retention** strictly from Plethora's unified learning evidence (`learning_evidence` + FSRS records) and session formative submissions, NEVER asking an LLM to fabricate mastery percentages, and explicitly showing `"Not assessed"` / `"Insufficient evidence"` when evidence is absent.

#### Scenario: Unassessed concepts explicitly display uncertainty
- **GIVEN** a learner has read a passage and viewed 3 explanations but completed 0 formative checks or FSRS reviews
- **WHEN** the learner opens the `Progress` tab
- **THEN** Exposure reflects the viewed supplements, Understanding displays `"Not assessed"` / `"Insufficient evidence"`, Retention displays `"Not assessed"`, and an actionable Recommended Next Session with estimated duration is shown.

#### Scenario: Evidence-backed concept breakdown reflects real outcomes and misconceptions
- **GIVEN** learning evidence records a `"needs-attention"` concept with a detected misconception and a `"demonstrated-consistently"` concept
- **WHEN** the `Progress` tab computes progress
- **THEN** both concepts appear with accurate mastery badges, uncertainty indicators, recorded misconceptions, and a targeted recommended next action.
