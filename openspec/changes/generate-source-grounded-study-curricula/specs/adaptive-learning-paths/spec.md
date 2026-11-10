## ADDED Requirements

### Requirement: Curriculum generation uses a bounded staged evidence pipeline

Curriculum generation SHALL freeze source identity/revisions, plan retrieval and checkpoint steps before inference, retrieve only within that frozen scope, decompose small evidence batches, reconcile nodes locally, infer handle-bound prerequisite candidates, validate structure/evidence, and present a reviewable draft. It SHALL NOT require an entire book/library in one prompt or permit the model to assign durable ids, write database rows, invoke tools, or retrieve outside the frozen scope.

#### Scenario: Multi-document generation is scoped

- **WHEN** a deep plan spans selected chapters from several documents
- **THEN** all retrieval has explicit frozen document filters and no prompt contains material outside the selected scope or current evidence batch

#### Scenario: Batch limits hold

- **WHEN** a request would exceed 24 documents, 12 decomposition seeds, 96 evidence hits or the batch character/handle limits
- **THEN** the coordinator deterministically selects/bounds the work or requests a narrower scope and records the sampling limitation rather than issuing an unbounded request

#### Scenario: Unsupported concept remains visible

- **WHEN** a proposed required concept cannot be grounded in selected material
- **THEN** it becomes a labelled material-gap/unsupported node with Find material or exclusion actions instead of a fabricated source reference or silent omission

### Requirement: Generated citations and identities are resolved by application logic

The model SHALL use only batch-local evidence and topic handles. The application SHALL resolve each source handle to live hydrated evidence, assign stable ids and semantic keys, validate every excerpt/revision/locator, and refuse unknown or cross-batch handles. A generated citation alone SHALL NOT establish source grounding.

#### Scenario: Forged handle is rejected

- **WHEN** model output cites an unknown evidence handle or an excerpt not present in that source
- **THEN** that candidate is invalid with a specific issue and no valid-looking grounded node is persisted/published from it

#### Scenario: Duplicate concepts reconcile conservatively

- **WHEN** two batches refer to the same canonical concept or user-confirmed same-as identity
- **THEN** the application merges their objectives/evidence without duplicate logical nodes; model rationale or vector similarity alone produces a warning, not a merge

### Requirement: Curriculum generation is checkpointed and recoverable

The system SHALL persist a narrow curriculum job and deterministic step/input hashes before inference and commit each completed draft batch with its job step in one transaction. Bounded concurrency SHALL include at most two Study AI jobs overall, one model call per job and one job per target. Cancellation SHALL preserve valid checkpoints and prevent stale commits; restart SHALL expose interrupted work for explicit consent-aware resume rather than silently restarting paid inference.

#### Scenario: Restart resumes only missing batches

- **WHEN** three of five decomposition batches committed before the application closes
- **THEN** reopening Study Plans marks the job interrupted and explicit Resume re-runs preflight then schedules only the two unfinished steps without duplicate nodes

#### Scenario: Cancel races provider completion

- **WHEN** cancellation increments the job epoch while a model request is in flight
- **THEN** the in-memory abort is signaled and a late result with the old lease/epoch cannot commit a node or advance progress

#### Scenario: Source changes mid-generation

- **WHEN** a selected document revision changes after the frozen job snapshot
- **THEN** the next step fails with source-changed, previous checkpoints/published plan remain intact and the user can start/rebase a new draft instead of mixing revisions

### Requirement: Partial generation is honest and actionable

The system SHALL preserve valid partial draft batches with per-step/per-node issues and allow retry, cancellation, manual editing or explicit discard. A malformed or failed batch SHALL NOT be silently replaced by generic topics and SHALL NOT make an invalid DAG publishable.

#### Scenario: One model batch is malformed

- **WHEN** one output fails its schema/validator after the task layer's allowed repair
- **THEN** the step records a safe invalid-model-output error, previously committed batches remain inspectable, and Publish is blocked until the user retries/edits/resolves the issue

#### Scenario: Disconnected topics are retained

- **WHEN** valid topics have no prerequisite relationship connecting them
- **THEN** deterministic ordering still handles the disconnected DAG and the preview does not invent edges merely to make the plan appear connected

### Requirement: Diagnostic evidence is optional and has one later producer

Curriculum generation SHALL work with no diagnostic and SHALL accept prior evidence only through the shared optional curriculum-prior-evidence contract. Change 7 SHALL own diagnostic creation, completion validation and the adapter to this input. Skipping a diagnostic SHALL create no attempt/evidence and SHALL NOT disable curriculum generation; unfinished or missing diagnostic data SHALL NOT be presented as completed evidence.

#### Scenario: User skips diagnostic

- **WHEN** a user chooses Skip diagnostic during curriculum creation
- **THEN** the normal source-grounded/no-AI planning path remains available with no phantom attempt or mastery claim

#### Scenario: Change 2 has no forward dependency

- **WHEN** Change 2 is complete before examination/evidence changes exist
- **THEN** all of its workflows and tests run with the optional prior-evidence input absent rather than importing future tables or leaving a required unfinished dependency

## MODIFIED Requirements

### Requirement: Paths derive from library structure, not free-form generation

Curriculum structure SHALL derive from frozen library evidence, canonical concepts and confirmed prerequisite relations, with the LLM confined to bounded topic/objective/rationale and prerequisite proposals. Node ordering SHALL be computed deterministically by the shared strict DAG algorithm using previous/manual position and stable tie-breakers; demonstrated-mastery input is optional and is absent until Change 6. Every generated node SHALL carry a why-here rationale when model-generated and current source references, or be an explicit unsupported/material-gap marker. No-LLM source inventory ordering SHALL be valid without claiming equivalent semantic decomposition.

#### Scenario: Ordering respects prerequisites

- **WHEN** a path is generated over a fixture graph where virtual memory requires memory which requires processes
- **THEN** the node order is topologically valid and reproducible across regenerations with unchanged inputs

#### Scenario: Material gaps are explicit

- **WHEN** a required concept has no covering source in the library
- **THEN** the node is marked as a material gap with find-material actions rather than silently omitted

#### Scenario: Model proposes a cycle

- **WHEN** prerequisite output creates a cycle or unknown endpoint
- **THEN** the invalid relation is reported and the draft cannot Publish until corrected; no cycle is appended after an otherwise valid prefix

### Requirement: Adaptation preserves user modifications

Plan regeneration/adaptation SHALL copy the current head into a new Draft with a reviewable diff and explicit acceptance. User-reordered/locked/added nodes and included=false removal tombstones SHALL be preserved unless structurally impossible; any forced lock-position change SHALL be explained. Generated nodes SHALL map to existing logical ids only by canonical concept or deterministic semantic key. Acceptance SHALL require the expected current head and SHALL NOT write global concept links or modify existing assessments.

#### Scenario: Locked node survives re-planning

- **WHEN** a path regenerates after the user locked a node's position
- **THEN** the diff shows the lock respected or an explicit impossibility/position-conflict explanation

#### Scenario: Removed node does not resurrect

- **WHEN** a model proposes the same canonical concept that the user removed in the base version
- **THEN** regeneration retains the excluded tombstone and shows it in the diff rather than adding it back automatically

#### Scenario: Head changes before acceptance

- **WHEN** another draft becomes current while generation is awaiting review
- **THEN** accepting the old-generated draft returns stale-revision and leaves the new head intact

### Requirement: Local-first with capability-gated generation

Rules-based source-inventory/confirmed-concept planning SHALL function locally without any LLM or subscription and clearly label omitted rationale/inference. Model-assisted decomposition/prerequisites SHALL use registered task routing with explicit reasoning/full degradation and endpoint-aware preflight under `adaptive_learning_paths`. It SHALL enforce feature activation, document AI-exclusion/local-only policy, embedding and generation destination disclosure and billable consent. Cloud/off-device execution SHALL be quota-bounded over compact evidence batches; no automatic remote/paid fallback or automatic resume is permitted.

#### Scenario: No-LLM path is valid

- **WHEN** generation runs with all AI disabled over selected source inventory/confirmed concepts
- **THEN** a valid, ordered, source-cited outline is produced with rationales and inferred edges omitted and its simpler-output limitation shown

#### Scenario: Local-only document rejects remote route

- **WHEN** selected material is local-only or AI-excluded and the proposed generation/embedding route leaves the device
- **THEN** processing is refused before excerpts are prepared/sent and the user can select a compliant local provider or reduce scope

#### Scenario: Remote fallback is not silently used

- **WHEN** the chosen local provider fails during a Study task
- **THEN** the step fails/recoverably pauses and no cloud provider is invoked unless the user explicitly starts/retries with that disclosed authorized route
