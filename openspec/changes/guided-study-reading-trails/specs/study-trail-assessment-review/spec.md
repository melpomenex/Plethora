## Purpose

Connect assigned reading to demonstrated understanding and targeted review with existing evidence and assessment history.

## ADDED Requirements

### Requirement: Formative practice from completed reading
The application SHALL offer a topic practice handoff after assigned reading is complete and preserve assessment scoring and answer visibility rules.

#### Scenario: Finish reading a topic
- **WHEN** the learner completes its assigned passages
- **THEN** the learner may start a separate topic check, and reading completion does not change mastery or assessment scores.

### Requirement: Review finalized question evidence
The application SHALL offer passage review for missed finalized questions with eligible matching assignments, preserving the attempt context. It SHALL preserve source evidence review for questions without a matching assignment.

#### Scenario: Review an older attempt
- **WHEN** the learner requests passage review for a missed question from a previous plan version
- **THEN** the application matches against that version and the recorded question evidence, and offers return to the same results.
