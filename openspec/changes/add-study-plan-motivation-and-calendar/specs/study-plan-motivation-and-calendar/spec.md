## Purpose

Help learners plan for a deadline and optionally recognize evidence-backed progress without changing actual review scheduling.

## ADDED Requirements

### Requirement: Deadline projections distinguish lessons and due reviews

A learner SHALL be able to add, extend or remove an exam deadline and select study/rest days. The plan SHALL distinguish remaining suggested lessons from actual or projected review work, label estimates and unavailable data, and preserve history when a deadline passes. Changes SHALL NOT reschedule existing cards. A passed deadline SHALL offer extend, complete or archive.

#### Scenario: A rest day has cards due
- **WHEN** a selected rest day has reviews scheduled
- **THEN** the suggested new-lesson load respects the rest day while the actual due count remains visible and unchanged

### Requirement: Recognition is optional and evidence-aligned

Optional quests, achievements, weekly cadence and session wrap-up SHALL be dismissible, non-punitive, accessible and secondary to the next learning action. Recognition for independent recall or transfer SHALL require eligible evidence; chat, reading time and unverified scores SHALL NOT earn it. Quiet and reduced-motion preferences SHALL be respected.

#### Scenario: Learner misses a scheduled day
- **WHEN** a learner takes a break or misses their preferred cadence
- **THEN** the plan and earned evidence remain available without penalties or mandatory recovery tasks

### Requirement: Outcome measurement is separate from engagement

Engagement measures SHALL be distinct from delayed independent performance on new items. Analytics SHALL default to local aggregates; network reporting, if enabled, SHALL require opt-in and omit raw learner inputs and source contents.

#### Scenario: More activity without better independent performance
- **WHEN** recognition increases sessions without improving delayed assessment results
- **THEN** the reported engagement change is not reported as a learning gain
