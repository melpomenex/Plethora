# Guided Study Trails Specification

## ADDED Requirements

### Requirement: First-Class Learning Segment Abstraction
The system SHALL persist `LearningSegment` records independently from citations, trail assignments, learner reading progress, and formal assessment evidence, with stable identity, source document revision, format-specific start/end locators, structural classification, instructional role, coverage status, and many-to-many objective links.

#### Scenario: Shared segment across multiple concepts
- **WHEN** a single coherent book section teaches two sequential concepts in a Study Plan
- **THEN** one `LearningSegment` is linked to both objectives via `learning_segment_objectives`
- **AND** the Study Trail planner avoids scheduling duplicate rereading of that segment.

#### Scenario: Source revision invalidation
- **WHEN** a source document's `content_hash` or revision changes after `LearningSegment` generation
- **THEN** affected segments are marked `stale` (`revision_changed`) rather than silently treated as current
- **AND** historical `exam_attempts`, `exam_grades`, and `learning_evidence` remain intact.

### Requirement: Instructional Content Classification and Exclusion
The instructional retrieval pipeline SHALL analyze document structure and deterministically exclude non-instructional regions (tables of contents, bibliographies, indexes, copyright/publisher front matter, bare chapter headings, repeated running headers/footers, and incidental keyword mentions) from ordinary required reading assignments, while supporting explicit contextual exceptions.

#### Scenario: Rejecting table of contents and bibliography matches
- **WHEN** a document contains the target concept's keywords in its Table of Contents, Bibliography, and Index, and has no explanatory prose for that concept
- **THEN** those non-instructional regions are excluded by `content_classifier`
- **AND** the objective's coverage status is reported as `no_match` or `insufficient` rather than promoting a meaningless citation.

#### Scenario: Contextual exception for research-methods bibliography
- **WHEN** an explicit contextual exception is enabled for bibliographic or reference-format study
- **THEN** bibliography units may be considered as candidates for that objective.

### Requirement: Coherent Section Expansion and Coverage Validation
Candidate chunks SHALL be expanded to coherent paragraph or section boundaries and evaluated for instructional quality and objective coverage (`adequately_covered`, `partially_covered`, `multi_segment`, `insufficient`, `no_match`, `source_unavailable`, `revision_changed`).

#### Scenario: Expanding a mid-argument chunk
- **WHEN** lexical or vector retrieval identifies a relevant chunk inside a multi-paragraph explanation
- **THEN** the pipeline expands the range to enclosing section/paragraph boundaries within the target duration window without splitting coherent arguments mid-explanation.

### Requirement: Prerequisite-Aware Study Trail Planning and Study Queue
The Study Trail planner SHALL order assignments using the existing `study_plan_prerequisites` DAG, preferring source continuity when prerequisites allow, grouping adjacent sections into coherent sessions, and surfacing a first-class **Study Queue** with a **Continue Learning** recommendation, prerequisite readiness, duration, rationale, and assignment actions.

#### Scenario: Blocked dependent concept in Study Queue
- **WHEN** concept B depends on prerequisite concept A and concept A is not yet completed
- **THEN** the Study Queue displays concept A as actionable in **Continue Learning** and marks concept B as blocked with a clear explanation of its unmet prerequisites.

#### Scenario: Preserving manual overrides during regeneration
- **WHEN** an author accepts, replaces, reorders, or manually edits an assignment (`authored_override = true`) and later regenerates the Study Trail
- **THEN** the manual override is preserved.

### Requirement: Format-Agnostic Guided Reading Mode
Opening an assignment from the Study Queue SHALL launch the existing `DocumentViewer` in **Guided Reading Mode** at the segment's start locator, displaying restrained start/end boundaries, a contextual Study Trail panel (desktop side panel / mobile compact sheet), reading progress within the range, notes/extracts and Socratic tutor access, and persistent resume state across EPUB, PDF, HTML, Markdown, Plain Text, and transcript-backed media.

#### Scenario: Resuming guided reading after restart
- **WHEN** a learner opens a guided reading assignment, reads partway through, saves/exits, and restarts the application
- **THEN** reopening the assignment restores the saved locator and progress within the segment.

### Requirement: Formative Comprehension Checks, Assessment Eligibility, and Remediation
Completing a reading assignment SHALL offer a brief objective-aligned formative comprehension check that provides feedback without mutating formal `exam_grades` or FSRS items, enforce configurable assessment eligibility policies (`guided`, `assessment-first`, `open`), and surface targeted `LearningSegment` remediation (including missing-prerequisite recommendations) when formal assessments reveal knowledge gaps.

#### Scenario: Formative check does not mutate formal exam grades
- **WHEN** a learner submits a formative comprehension check
- **THEN** the result is persisted in `formative_check_results`
- **AND** existing `exam_attempts`, `exam_grades`, and FSRS card states remain unchanged.

#### Scenario: Targeted remediation after failed assessment objective
- **WHEN** a learner fails an objective on a formal assessment
- **THEN** the remediation workspace surfaces the most relevant verified `LearningSegment`s for that objective (or its unmet prerequisite) and offers a distinct follow-up check or reassessment path.
