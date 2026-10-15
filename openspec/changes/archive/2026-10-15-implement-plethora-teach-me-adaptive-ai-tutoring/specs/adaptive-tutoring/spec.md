## ADDED Requirements

### Requirement: Lessons follow a structured adaptive flow
"Teach me" SHALL run a lesson state machine (diagnose → explain → analogy → example → check → evaluate → adapt → remediate → consolidate), composable and skippable per content type, reusing the existing turn caps and context distillation. Lessons SHALL be resumable sessions.

#### Scenario: Misconception triggers remediation
- **WHEN** an evaluate stage returns a misconception verdict
- **THEN** the lesson remediates from the failed prerequisite (graph walk when available) before continuing

#### Scenario: Strong prior knowledge accelerates
- **WHEN** diagnosis answers are correct and confident
- **THEN** the lesson skips basic explanation and moves to deeper material

### Requirement: Diagnosis calibrates from mastery estimates
When entry context includes a concept with a mastery estimate (proposal 10), diagnosis SHALL calibrate starting difficulty, widening scope when variance is high. Estimates influence, never dictate, the flow.

#### Scenario: Wide variance starts broad
- **WHEN** a concept's mastery estimate has high variance
- **THEN** diagnosis begins with broader probing questions

### Requirement: Explanations are grounded with labeled fallback
Lesson explanations SHALL ground in the user's library via retrieval with citations; when coverage is absent the tutor SHALL explicitly label content as beyond-the-library rather than citing nothing as if sourced. Fabricated citations SHALL fail validation.

#### Scenario: Beyond-library answer is labeled
- **WHEN** retrieval returns no relevant chunks for a tutor explanation
- **THEN** the turn is labeled as general knowledge with a find-material suggestion, and no citations render

### Requirement: Generated cards come only from demonstrated weaknesses
Consolidation SHALL propose flashcards seeded from failed checks and remediated misconceptions, routed through the card preview/edit/accept flow (proposal 13). No card SHALL be created without explicit user acceptance.

#### Scenario: Weakness-seeded proposals
- **WHEN** a lesson ends after two failed checks
- **THEN** proposed cards target those weaknesses and await acceptance in preview

### Requirement: Entry points route with context
Teach me SHALL be invocable from selection actions, graph concept nodes (9), gap cards (10), path nodes (11), and the command palette, each carrying structured context (selection/quote, concept ref, gap evidence) into the lesson.

#### Scenario: Gap entry carries evidence
- **WHEN** launched from a knowledge-gap card
- **THEN** the lesson opens with the gap's evidence summary as diagnosis context

### Requirement: Hosted tier is capability-gated; local stays free
On-device (Nano) and BYO-provider lessons SHALL function without subscription. Plethora-hosted premium-model lessons SHALL require `ai_tutoring` with per-period turn quotas, disclosed data flow, and graceful degradation (reason surfaced) when exhausted.

#### Scenario: Quota exhaustion degrades gracefully
- **WHEN** hosted lesson turns are exhausted mid-lesson
- **THEN** the lesson offers continuing on the local/BYO backend with a clear reason instead of aborting
