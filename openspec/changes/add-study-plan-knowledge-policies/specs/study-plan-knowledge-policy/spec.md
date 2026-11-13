## Purpose

Give Study Plan learners explicit control over factual authority, provider use, and what qualifies as verified study evidence.

## ADDED Requirements

### Requirement: Plan versions preserve explicit knowledge authority

AI-powered Study Plans SHALL expose Library Only, Library + AI Knowledge and AI Knowledge Only with plain-language consequences. New plans SHALL suggest Library + AI Knowledge when eligible material is selected and AI Knowledge Only with no material; prior preference is advisory. Neither preference nor missing/stale sources SHALL silently change an explicit choice or existing plan. Library modes SHALL freeze a nonempty resolved scope, including concrete collection/tag membership and revisions. AI Knowledge Only SHALL carry no library scope and SHALL NOT use library retrieval, embeddings or automatic Web Research. Manual authoring SHALL work without sources or AI; a deterministic source outline SHALL require sources and work without AI. Changing an existing plan's authority SHALL require a reviewed new version.

#### Scenario: Selection changes after an explicit choice
- **WHEN** a learner chooses Library Only and removes all selected material
- **THEN** the flow asks them to select material or explicitly switch policy, and sends no model request

#### Scenario: Empty-library plan
- **WHEN** a learner generates an AI Knowledge Only plan with no library documents
- **THEN** generation can complete without source preparation, and the preview visibly labels model output unverified

#### Scenario: Offline no-model options
- **WHEN** no model is configured
- **THEN** a blank manual plan and a deterministic outline over selected material remain usable offline

### Requirement: Attribution reflects validated support

Material factual claims in AI outputs SHALL distinguish verified library evidence, explicitly unverified model supplements, and model-generated unverified content. Verified library evidence SHALL resolve to an eligible selected document revision and exact locator and support the associated claim. Library Only SHALL withhold unsupported AI claims as facts and expose missing support and next actions. Mixed mode SHALL label supplements inline and identify conflicts with library authority, including at the prerequisite level. User-authored content SHALL remain distinguishable. Source/index limitations SHALL be visible, and stale references SHALL preserve their historical revision and offer review or revalidation.

#### Scenario: Mixed mode proposes a missing prerequisite
- **WHEN** an otherwise valid proposal introduces a prerequisite the selected sources do not support
- **THEN** the learner can inspect, reject or keep it as an AI supplement, or add material in a reviewed draft

#### Scenario: Forged or stale citation
- **WHEN** an output cites a handle outside the frozen scope or the referenced passage no longer matches
- **THEN** it is never shown as current verified support and the learner sees an actionable explanation

#### Scenario: Exact source navigation
- **WHEN** a learner opens verified support from a PDF or video transcript
- **THEN** navigation lands at the validated page/passage or timestamp for that evidence

### Requirement: Draft review precedes publication

Creation SHALL collect a goal, show available material and policy, and present a manageable ordered preview before publication. Learners SHALL be able to inspect references, edit, lock, exclude and reorder within prerequisites, save for later, and explicitly accept a version diff. Failure, cancellation or a stale head SHALL preserve recoverable work and SHALL NOT replace the published version.

#### Scenario: Another draft replaces the reviewed head
- **WHEN** an older generated preview is accepted after the current head changes
- **THEN** acceptance reports a version conflict and the new head is preserved

### Requirement: Execution consent is independent of knowledge policy

Study AI SHALL disclose exact provider/model, endpoint class, separate inference/embedding destinations, estimated tokens/calls/cost where available, hard limits and actual usage. Unknown prices SHALL be identified. Exclusion, local-only, feature access, data-flow approval and cost limits SHALL be enforced before preparation and transmission and rechecked before explicit retry, resume or route change. There SHALL be no hidden cloud or paid fallback.

#### Scenario: Retry changes a destination
- **WHEN** a resumed job changes to a remote inference or embedding endpoint
- **THEN** it discloses the new destination and refuses processing until authorized and eligible

#### Scenario: Restricted source
- **WHEN** a job includes AI-excluded material or tries to route local-only material off-device
- **THEN** it fails before restricted text is prepared or transmitted and retains the draft

### Requirement: Assessment trust is independent of plan policy

Verified exams SHALL require independently supported, validated question and key/rubric revisions; mixed supplements alone SHALL NOT qualify. AI Knowledge Only SHALL allow labeled unverified practice or a diagnostic self-check but SHALL NOT issue a verified exam grade or demonstrated evidence without verified authority. Adding sources SHALL require a new verification draft and SHALL NOT upgrade earlier attempts.

#### Scenario: Plausible key is still unverified
- **WHEN** a model-only question passes structural checks and its answer is marked correct
- **THEN** the result is labeled unverified, excluded from demonstrated evidence and ineligible for verified exam publication

#### Scenario: Sources added later
- **WHEN** a learner adds references to verify new questions
- **THEN** only newly verified revisions become eligible, and earlier attempts retain their original labels
