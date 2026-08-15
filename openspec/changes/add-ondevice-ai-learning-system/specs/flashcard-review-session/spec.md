## ADDED Requirements

### Requirement: Optional free-response capture before grading

The review session SHALL present an optional free-response input before revealing the
answer, but only when answer assessment is enabled and an assessment-capable provider is
available. The input SHALL be skippable, and the reveal/grade flow SHALL NOT change when it
is skipped or when the feature is disabled.

#### Scenario: Free-response answered before grading
- **WHEN** answer assessment is enabled and the user types a free-response answer before
  revealing the card answer
- **THEN** the system derives and displays a structured assessment alongside the revealed
  answer, and the grade buttons remain exactly the standard ones

#### Scenario: Feature disabled leaves review unchanged
- **WHEN** answer assessment is disabled or no provider is available
- **THEN** the review session behaves identically to the existing experience with no
  additional input or errors

### Requirement: Scheduling semantics unchanged by assessment

The review session's queue composition, grade submission, and scheduling SHALL remain exactly
as specified by the existing requirements. Free-response assessment SHALL be recorded as
separate metadata linked to the review result and SHALL NOT alter grade routing or scheduler
inputs.

#### Scenario: Grading with assessment present
- **WHEN** the user submits a grade on a card whose answer was assessed
- **THEN** the rating is routed through the flashcard scheduler exactly as without assessment,
  and the assessment is stored separately
