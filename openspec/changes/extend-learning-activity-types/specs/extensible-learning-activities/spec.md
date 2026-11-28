# Extensible Learning Activities Specification

## ADDED Requirements

### Requirement: Capability-Negotiated LearningActivityRegistry
Plethora SHALL provide a typed `LearningActivityRegistry` where every learning activity declares an `ActivityTypeManifest` (capabilities, platform support, target competency dimensions, and privacy policy) and negotiates runtime availability deterministically without requiring cloud AI.

#### Scenario: Activity degrades gracefully when AI provider is absent
- **GIVEN** no AI provider is configured in Plethora
- **WHEN** the Unified Learning Session Runtime negotiates `socratic_dialogue`
- **THEN** `LearningActivityRegistry` returns `status = "degraded"` and launches the deterministic structured self-questioning fallback without throwing an error or blocking the session.

#### Scenario: Activity unavailable on current platform resolves deterministic fallback
- **GIVEN** an activity requires a capability unavailable in the current runtime environment
- **WHEN** `negotiateActivity` evaluates the manifest
- **THEN** it returns `status = "unavailable"` along with a localized reason and a valid registered `fallbackActivityId`.

### Requirement: Thirteen Initial First-Party Learning Activity Types
The registry SHALL ship with 13 registered first-party activity types (`incremental_reading`, `flashcard_review`, `extract_processing`, `guided_reading_trail`, `socratic_dialogue`, `formative_check`, `formal_examination`, `worked_example_study`, `problem_solving_drill`, `code_tracing_and_synthesis`, `language_production_practice`, `synthesis_and_concept_mapping`, `exploratory_feed_digest`) that lazy-load their UI surfaces, reuse the canonical `DocumentViewerWrapper` for reading activities, and emit validated canonical `learning_events`.

#### Scenario: Reading-based activities reuse the single canonical reader host
- **GIVEN** a Unified Learning Session transitions from `incremental_reading` to `guided_reading_trail` on a document
- **WHEN** the session renders the activity surface
- **THEN** both activities mount inside `study-canonical-reader-host` via `DocumentViewerWrapper` without spawning a duplicate reader instance.

#### Scenario: Exploratory feed digest does not create mandatory SRS obligations
- **GIVEN** a learner completes an `exploratory_feed_digest` activity
- **WHEN** the adapter emits its canonical `learning_events` record
- **THEN** it records `exposure` evidence only and creates zero FSRS-7 review items unless the learner explicitly extracts or promotes content.

### Requirement: Five Declarative Subject Templates
Plethora SHALL provide five declarative subject templates (`mathematics`, `computer_science`, `philosophy`, `languages`, `history_literature`) whose activity mixes reference registered activity IDs and whose competency dimension weights sum to `1.0`.

#### Scenario: Creating a Mathematics Learning Goal applies the Mathematics template
- **GIVEN** a learner creates a new Learning Goal and selects the `mathematics` subject template
- **WHEN** the goal is saved
- **THEN** the goal is initialized with the Mathematics activity mix (`worked_example_study`, `problem_solving_drill`, `flashcard_review`, `formative_check`) and competency weights, and the learner may customize the weights afterward without mutating the built-in template.

### Requirement: Sandboxed Security Extension Boundary with Zero Arbitrary Native Execution
Learning activities and future extensions SHALL NEVER execute arbitrary code or shell commands via privileged Tauri commands; external extensions SHALL execute strictly inside a sandboxed Web Worker or isolated iframe (`sandbox="allow-scripts"`, no `allow-same-origin`, no Tauri IPC) communicating through a host-validated `postMessage` bridge that enforces capability grants and document privacy redaction.

#### Scenario: Untrusted extension attempts to access a local-only document or forge an exam grade
- **GIVEN** a sandboxed activity extension is running in an isolated worker/iframe
- **WHEN** the host prepares a document marked `isLocalOnly = true` OR the extension posts an event attempting to forge `formal_exam_grade`
- **THEN** the host blocks transmission of the `isLocalOnly` document to the extension and rejects the forged event before any write reaches `learning_events` or `competency_evidence`.

#### Scenario: Code tracing activity operates without OS process execution
- **GIVEN** a learner completes a `code_tracing_and_synthesis` activity
- **WHEN** the learner submits a trace table and output prediction
- **THEN** verification executes purely via deterministic static/rubric evaluation in the frontend/sandbox with zero Tauri shell or subprocess invocations.
