## Purpose

Lets learners configure, generate, inspect, edit and publish source-grounded fixed assessments with durable blueprints, exact quotas, precommitted answers and transparent rubrics while preserving offline/local provider control and complete revision provenance.

## ADDED Requirements

### Requirement: Assessment blueprints are durable and source-scoped

The system SHALL persist blueprint containers and immutable Ready revisions with an optional Study Plan/version lineage, frozen source scope, `exam|practice|diagnostic` mode, requested count, type/difficulty/topic weights, optional timer, knowledge policy, question-repeat exclusions, scoring policy, generation status, validation and provider provenance. Ready revision configuration and source snapshot SHALL NOT change after publication; later edits SHALL create a new Draft revision.

#### Scenario: Plan-linked blueprint survives restart

- **WHEN** a user configures an exam for two selected Study Plan topics and reopens Plethora
- **THEN** the blueprint revision restores its exact source snapshot, quotas, weights, timer/mode/scoring policy and generation state without inference

#### Scenario: Plan changes do not mutate paper

- **WHEN** a Study Plan advances to a new version after an assessment became Ready
- **THEN** the existing Ready assessment remains bound to its original plan version/source snapshot and its questions are unchanged

#### Scenario: Custom source scope is supported

- **WHEN** a user chooses a fixed set of documents/extracts instead of a Study Plan
- **THEN** the same blueprint/editor/validation workflow operates with null plan lineage and actual selected source ids

### Requirement: Question quotas are deterministic and insufficiency is explicit

The system SHALL allocate requested type, topic and difficulty totals by the shared largest-remainder/stable-tie rules and construct stable reproducible quota slots. Failed or invalid generation SHALL leave slot deficits and a per-cell quota report. If only 17 of 30 valid questions exist, the system SHALL show exactly 17 accepted and the remaining deficits, allow retry or manual edits, and publish/start the shorter paper only after the user explicitly accepts that shortfall. It SHALL NOT fabricate, duplicate or silently substitute questions to reach 30.

#### Scenario: Exact allocation is stable

- **WHEN** unchanged requested total and type/topic/difficulty weights are allocated repeatedly
- **THEN** every marginal count sums to the requested total and slot keys/properties are identical across runs

#### Scenario: Partial output is not padded

- **WHEN** 30 questions are requested and only 17 pass validation after initial and allowed recovery batches
- **THEN** the revision remains Needs Review with 13 itemized deficits and Start is refused until retry, editing or explicit acceptance of 17/30

#### Scenario: Configuration change invalidates earlier shortfall acceptance

- **WHEN** a user previously accepted a shortfall on a mutable draft and changes its count/weights/targets/source/questions before Publish
- **THEN** native persistence resets shortfallAccepted and the changed paper again requires its current explicit shortfall acceptance; a copy-edit of Ready also resets rather than inheriting historical approval

#### Scenario: Shortfall acknowledgement is not implicit

- **WHEN** a user previews 17 valid questions without accepting the shortfall
- **THEN** starting the exam returns quota-shortfall and creates no attempt

### Requirement: Every question revision is schema-valid and gradeable by construction

The system SHALL support exactly the five shared question discriminants and typed responses: single-select, multi-select, segmented cloze, short-answer and essay. Conceptual application and multi-step reasoning SHALL be represented by `applicationLevel` and validated rubric/objective expectations. Publication SHALL run the same type-specific structural/grading rules used by public projection and scoring, rejecting ambiguous optional-field combinations, unknown option/blank/criterion ids or unresolvable keys.

#### Scenario: Valid single-select commits

- **WHEN** a single-select item has 2–8 unique nonempty options and exactly one correct stable option id backed by verified evidence
- **THEN** its key resolves deterministically and it may become Ready after all other validations pass

#### Scenario: Invalid or accidentally multi-correct single-select is rejected

- **WHEN** option texts duplicate, the correct id is unknown, or several correct answers are supplied for single-select
- **THEN** publication is refused with exact field paths rather than mapping an unknown key to incorrect

#### Scenario: Multi-select keys are exact and consistent

- **WHEN** a multi-select item has at least two correct option ids and at least one distractor
- **THEN** all correct ids resolve uniquely, the key is stored as a sorted set, and its all-or-nothing scoring policy is visible before Start

#### Scenario: Valid segmented cloze commits

- **WHEN** cloze segments reference each nonempty blank exactly once and each blank has distinct accepted alternatives including a verbatim source deletion
- **THEN** accepted answers remain private to the taking view and grading can resolve every blank

#### Scenario: Invalid cloze is blocked

- **WHEN** cloze has an orphan/missing blank, exposes an answer in surrounding text, has duplicate normalized alternatives, or its deletion is absent from cited evidence
- **THEN** the item is invalid with a specific issue and cannot be presented as a Ready exam question

#### Scenario: Short answer commits its expectations

- **WHEN** a short-answer question is published
- **THEN** it has a nonempty reference answer, bounded required key facts, optional exact full-credit alternatives and a committed valid rubric linking required key facts to criteria

#### Scenario: Essay has an analytic rubric

- **WHEN** an essay or multi-step technical question is published
- **THEN** expected reasoning and 2–8 independently judged criteria with nonzero weights, five level descriptors and appropriate evidence are committed before Start and maximum points are fixed

### Requirement: Assessment questions have verified multi-source evidence

Every published question SHALL link to at least one current application-validated primary `StudySourceRefV1`; up to four ordered primary/supporting/expected-answer refs MAY provide multi-document evidence. The application SHALL resolve model-supplied handles, validate source text/revisions/locators and target concept/objective links. Source-plus-model-knowledge mode SHALL NOT exempt an exam answer or factual rubric criterion from evidence validation.

#### Scenario: Generated evidence navigates to origin

- **WHEN** a user inspects a current question citation for a supported PDF page, EPUB range, text passage, audio/YouTube timestamp or local video extract
- **THEN** the appropriate existing reader action resolves that source or explicitly reports stale/missing/ambiguous/unsupported navigation

#### Scenario: Deleted source does not erase exam history

- **WHEN** cited material is deleted after publication
- **THEN** stored historical question/key/rubric/evidence excerpts remain inspectable with Missing Source, and future Ready publication cannot treat the deleted ref of that old snapshot as current grounding for newly generated items

### Requirement: Answer keys and rubrics are mechanically immutable after commitment

A Ready question revision SHALL include its complete correct key/reference answer, accepted alternatives, expected reasoning and analytic rubric before any attempt can start. Native persistence SHALL reject updates to committed content/key/rubric/kind/points/slot/fingerprint; changes SHALL create a new uncommitted question and blueprint Draft revision. Attempts SHALL pin stable question revisions. Later answer-dependent grading SHALL use the committed key/rubric and SHALL NOT rewrite it.

#### Scenario: Edit after Ready preserves old paper

- **WHEN** a user corrects a wrong answer key on a Ready paper
- **THEN** the correction appears in a new Draft requiring validation/publication and any previous attempt still references the original committed revision with its history intact

#### Scenario: Database update is refused

- **WHEN** an implementation or UI operation attempts to modify the committed correct option or rubric in place
- **THEN** the native immutability guard rejects it with committed-question-immutable and the prior values remain intact

#### Scenario: Unused deletion is explicit and history deletion is forbidden

- **WHEN** a user explicitly deletes an entirely unused blueprint with no attempts against any revision
- **THEN** its whole owned draft/committed question graph may be deleted through that single blueprint deletion transaction; direct single-question reparent/delete has no command, and any attempted/history reference forbids the operation and preserves the fixed paper

#### Scenario: Hidden answers are not misrepresented as secure

- **WHEN** the taking UI requests public questions before submission
- **THEN** the response excludes keys/references/accepted answers/expected reasoning and private rubric details and all precommitted hints while local documentation identifies this as answer-hiding UX, not cryptographic secrecy

### Requirement: Question generation is checkpointed, validated and duplicate-aware

Generation SHALL reuse Change 2's Study job/preflight/source services and run in at most four-slot desktop or two-slot mobile batches. Each complete question/key/rubric proposal SHALL be contained, structured and fail-closed validated before checkpoint. Initial batches and at most an equal number of explicit recovery batches SHALL bound model calls. Exact/near duplicates SHALL be blocked or itemized for review under the shared fingerprint/similarity policy; retries SHALL reuse slot keys and never duplicate committed candidates.

#### Scenario: Crash between batches

- **WHEN** two of four question batches committed before the process stopped
- **THEN** Resume repeats preflight and processes only unfinished/failed slots without duplicate question ids or overwriting valid previews

#### Scenario: Repeated question is detected

- **WHEN** a generated candidate's fingerprint duplicates a valid item in the same revision or its normalized token-3-gram similarity to an excluded prior item is at least 0.85
- **THEN** that candidate does not silently fill a new slot and the quota report identifies a duplicate/deficit for user review

#### Scenario: Model injections do not alter authoring rules

- **WHEN** source text directs the model to reveal keys, omit a rubric or cite another document
- **THEN** it remains untrusted data, output validation/containment rules still apply, and no model tool/database write is offered

### Requirement: Users can preview, edit, exclude and manually author assessments

The system SHALL provide a paper-level blueprint/quota/validation summary and per-question editor covering its selected type, sources, key/reference and rubric. Editing SHALL rerun identical validators and mark an invalid item until corrected. Excluding a question SHALL leave a disclosed deficit rather than silently reorder its committed key. Users with no provider SHALL be able to create a valid paper manually and take it after publication.

#### Scenario: Manual offline paper is Ready

- **WHEN** AI is unavailable and a user manually authors/keys/rubricates source-grounded items satisfying its blueprint quotas
- **THEN** the user can preview, publish and later start that paper with no network/provider

#### Scenario: Edit-time correction revalidates

- **WHEN** the user repairs a cloze deletion or invalid option id in preview
- **THEN** all key/source/gradeability checks rerun and only a valid committed revision can become Ready

### Requirement: Assessment generation respects provider capability, privacy and cost boundaries

Blueprint/previews SHALL disclose the selected provider/actual model route, reasoning fallback/validation provenance, selected source excerpts that leave the device, maximum model calls and billability before generation/resume. No provider or unsupported advanced mode SHALL block manual authoring or already-generated papers. Provider failure SHALL leave safe partial state and never trigger an undisclosed paid or remote fallback.

#### Scenario: No provider does not destroy a draft

- **WHEN** no text provider is available at Generate
- **THEN** AI generation is not started, the configuration/draft is retained and the UI offers manual authoring/provider configuration

#### Scenario: Local-only source uses compliant route

- **WHEN** selected sources are local-only/AI-excluded or strict-local-only is enabled
- **THEN** unauthorized source/embedding remote processing is refused before extraction/transmission and the preview names the required compliant route

#### Scenario: Reasoning fallback is visible

- **WHEN** essay/rubric generation runs through its full-class twin
- **THEN** provider metadata and a quality-review warning are retained; the system does not claim that text-generation support proves strong rubric quality
