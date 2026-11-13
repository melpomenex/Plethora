## Purpose

Let learners study a versioned objective through a resumable lesson, with optional diagnosis and a clear handoff to independent assessment.

## ADDED Requirements

### Requirement: Lessons resume at the last committed action

A learner SHALL be able to start or continue a lesson for a specific plan version, topic and objective. The lesson SHALL show the objective, why it matters, and the source status. It SHALL persist the current prompt, learner input, hint position, style, and validated turns, and restore them after interruption without issuing an automatic request or duplicating a committed turn. Changed sources or versions SHALL be visible, with a reviewed update or new lesson offered.

#### Scenario: Restart with an answer in progress
- **WHEN** the app closes after the learner types an answer and reveals two hints
- **THEN** reopening restores the same question, answer draft, and revealed hints for that version

#### Scenario: Source becomes unavailable
- **WHEN** a frozen reference is stale, deleted or newly restricted on resume
- **THEN** the saved lesson remains visible where permitted and the affected AI action offers recovery before any new source processing

### Requirement: Learners control how the tutor teaches

Guided Socratic SHALL be the default and ask one focal question at a time. Explain + Check and Challenge Me SHALL be independently selectable without curriculum regeneration. Learners SHALL be able to enter reasoning or optional confidence and choose Not sure, Hint, Show source, Explain directly, or Skip as applicable. After two unproductive probes or at most three escalating hints, the tutor SHALL offer a worked explanation and fresh check or a pause. Conversational checks and self-report SHALL be provisional; independent practice SHALL use a separate explicitly started attempt.

#### Scenario: Learner is stuck
- **WHEN** a learner repeatedly cannot answer or uses the full hint sequence
- **THEN** the tutor offers explain-and-check or pause and does not continue probing automatically

#### Scenario: Switching style mid-lesson
- **WHEN** the learner chooses Explain + Check
- **THEN** the style applies to the next action without changing the plan, provenance, or historical turns

### Requirement: Diagnostic is optional and adapts only a reviewed draft

A learner SHALL be able to take or skip a diagnostic from a provisional curriculum without blocking the first lesson. The source-backed diagnostic SHALL reuse the existing exam engine, offer 4–12 items (default 6), and resume the same committed items and responses. Only finalized eligible results for the matching draft and source scope SHALL be proposed for adaptation; acceptance SHALL produce a reviewable diff preserving prerequisite validity and user edits. Model-only probes SHALL be labeled unverified and SHALL NOT drive evidence-based adaptation. Skipping SHALL create no job, attempt, or evidence.

#### Scenario: Results propose a change
- **WHEN** the learner finishes a diagnostic with final eligible results
- **THEN** an explanation and proposed reorder are shown while the plan stays unchanged until acceptance

#### Scenario: Grading is incomplete or results are stale
- **WHEN** final grades are unavailable or the draft/source scope differs from the attempt
- **THEN** Apply Results is unavailable and the learner can still proceed with the current curriculum

### Requirement: The lesson remains operable across devices

Lesson and diagnostic routes SHALL support keyboard, touch, screen reader focus/status, reduced motion and narrow or landscape layouts. Dictation SHALL be optional where supported. Permitted on-device tutoring SHALL remain available offline; when AI is unavailable the plan, readable sources and manual study actions SHALL remain accessible.

#### Scenario: Narrow-screen lesson recovery
- **WHEN** a learner resumes on a supported mobile screen
- **THEN** the prompt, composer, and explanation/skip controls are reachable without pointer-only gestures
