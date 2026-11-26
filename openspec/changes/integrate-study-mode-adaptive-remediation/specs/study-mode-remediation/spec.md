# Study Mode Adaptive Remediation Specification

## ADDED Requirements

### Requirement: Evidence-Driven Misconception Remediation
When formative or formal `learning_evidence` records a misconception or concept weakness, Study Mode SHALL offer targeted, user-controlled remediation actions (source passage revisit, alternate explanation, worked example, Socratic tutor, distinct-question practice, or explicit flashcard promotion) without automatically mutating published Study Plans.

#### Scenario: Remediation after misconception without FSRS mutation
- **WHEN** a learner submits an incorrect formative answer identifying a misconception on a concept that has an existing flashcard
- **THEN** Study Mode records `learning_evidence` and proposes targeted remediation
- **AND** the existing flashcard's FSRS memory state remains unchanged.
