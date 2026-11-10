## ADDED Requirements

### Requirement: Study Plan tutoring preserves validated source scope

A Study tutor launch SHALL supply topic, bounded validated source excerpts, learning objectives and any gap/misconception/evidence summary to the existing TutorSession/TutorSheet. Its retrieval callback SHALL call existing library retrieval with explicit document filters derived from current validated Study Source refs. An empty, deleted or unauthorized Study sourceDocumentIds set SHALL refuse scoped launch or request a source correction rather than falling back to global-library retrieval. Existing non-Study tutor hosts SHALL retain their current retrieval defaults.

#### Scenario: Teach me carries curriculum context

- **WHEN** a user selects Teach Me on a weak Study Plan topic with PDF and video-extract evidence
- **THEN** TutorSheet opens with that topic/objectives/misconception and bounded excerpts and every retrieval request filters to those source documents

#### Scenario: Tutor respects existing bounds

- **WHEN** a Study tutor conversation runs into stuck, hint, turn or escape-hatch conditions
- **THEN** the existing TutorSession policy state machine enforces the same limits and behavior as selection-based tutoring

#### Scenario: Deleted source prevents implicit global grounding

- **WHEN** all current source refs for the Study topic are missing/deleted
- **THEN** scoped Study launch reports missing source rather than silently retrieving an arbitrary same-topic passage elsewhere in the library

### Requirement: Tutor dialogue is not treated as graded examination evidence

Socratic tutor sessions MAY use existing hint/explanation/card-proposal behavior, but tutor prose and learner conversation SHALL NOT directly create final assessment grades, demonstrated-performance evidence, mastery states or scheduler ratings. Only an explicitly checked Practice/Exam/Diagnostic response with a final authorized grade supplies performance evidence.

#### Scenario: Tutor explanation does not imply mastery

- **WHEN** a learner completes a tutor explanation or says they understand without a checked assessment
- **THEN** Study activity/conversation may be reflected separately but demonstrated evidence remains unchanged

#### Scenario: Tutor card conversion remains a proposal

- **WHEN** the existing tutor offers card conversion
- **THEN** candidates still use the ordinary preview/edit/accept flow and no card or FSRS rating is written without user acceptance
