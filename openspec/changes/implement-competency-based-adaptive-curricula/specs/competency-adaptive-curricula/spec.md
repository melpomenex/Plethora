# Specification: Competency-Based Adaptive Curricula

## ADDED Requirements

### Requirement: Rich Typed Conceptual Relationships
The curriculum graph system MUST support seven explicit relationship types between curriculum nodes and concepts: `requires`, `builds_upon`, `related_to`, `example_of`, `contrasts_with`, `applies`, and `alternative_explanation_of`. Existing prerequisite edges migrated from earlier versions MUST default to `relationship_type = 'requires'` without breaking existing Study Plans.

#### Scenario: Persist and project typed conceptual edges
- **GIVEN** a Study Plan containing nodes `A`, `B`, and `C`
- **WHEN** the learner or curriculum generator links `A -> B` with `relationship_type = 'requires'` and `C -> B` with `relationship_type = 'alternative_explanation_of'`
- **THEN** both edges MUST persist with their exact `relationship_type` in SQLite and appear with distinct semantics in the graph projection
- **AND** `C -> B` MUST NOT block `B` from becoming ready

#### Scenario: Enforce acyclicity strictly on requires edges
- **GIVEN** a Study Plan with active `requires` edges `A -> B` and `B -> C`
- **WHEN** an operation attempts to add or retype an edge `C -> A` as `requires`
- **THEN** validation MUST reject the mutation with a `CYCLE_DETECTED` error identifying `[A, B, C, A]`
- **AND** adding a `contrasts_with` or `related_to` edge between `C` and `A` MUST succeed without triggering a cycle error

---

### Requirement: Relationship Provenance, Uncertainty, and Non-Blocking Bypass
Every curriculum relationship edge MUST record its `provenance` (`manual`, `source_explicit`, `ai_inferred`, `imported`), `confidence` (`0.0..=1.0`), and `is_uncertain` flag. Uncertain AI-inferred prerequisites MUST NEVER block learner progress, and any high-confidence `requires` prerequisite MUST support immediate one-click learner bypass and edge correction.

#### Scenario: Uncertain AI-inferred prerequisite does not block entry
- **GIVEN** an AI-generated curriculum edge `A -> B` with `relationship_type = 'requires'`, `provenance = 'ai_inferred'`, and `confidence = 0.55`
- **WHEN** the adaptive progression engine evaluates node `B` while node `A` is uncompleted
- **THEN** the edge MUST be flagged `is_uncertain = true`
- **AND** node `B` MUST remain directly launchable without a hard lock, displaying an advisory uncertain-prerequisite indicator with confirm, retype, and dismiss controls

#### Scenario: Learner bypasses or corrects a prerequisite edge
- **GIVEN** a node `B` with a high-confidence `requires` edge from uncompleted node `A`
- **WHEN** the learner selects "Bypass prerequisite" with an optional reason or retypes the edge to `builds_upon`
- **THEN** the override MUST be persisted in SQLite (`user_override_state = 'bypassed'` or `'retyped'`)
- **AND** node `B` MUST immediately transition to `ready`
- **AND** the learner MUST be able to undo the bypass later without losing study history

---

### Requirement: Diagnostic Placement and Non-Destructive Adaptive Progression
The curriculum runtime MUST compute an adaptive progression overlay by combining the Study Plan graph with verified 5-dimension competency projections from the persistent learner model and optional diagnostic assessments. Nodes already demonstrated by prior verified evidence MUST be marked `demonstrated_prior` and offered as skippable without deleting nodes or history. Exposure-only reading events MUST NOT trigger `demonstrated_prior`.

#### Scenario: Prior verified mastery marks a node skippable non-destructively
- **GIVEN** a learner opens a new Study Plan containing node `N` linked to concept `K`
- **AND** the persistent learner model already holds verified `sufficient` competency evidence for `K` above the plan's demonstration threshold from another Learning Goal or prior exam
- **WHEN** the adaptive progression overlay is computed
- **THEN** node `N` MUST be labelled `demonstrated_prior` and treated as satisfied for downstream `requires` readiness
- **AND** node `N` MUST remain visible, intact, and manually reopenable by the learner

#### Scenario: Exposure-only activity does not skip curriculum nodes
- **GIVEN** a concept `K` has high `exposure` from page views but `insufficient-evidence` on `comprehension`, `retention`, and `application`
- **WHEN** the adaptive progression overlay evaluates a node linked to `K`
- **THEN** the node MUST NOT be marked `demonstrated_prior`

#### Scenario: Diagnostic placement is strictly optional
- **GIVEN** a learner starts a Study Plan whose concepts have `unknown` or `insufficient-evidence` competency
- **WHEN** the optional diagnostic prompt is presented
- **THEN** the learner MUST be able to dismiss or skip the diagnostic in one click and immediately begin studying from the first ready node

---

### Requirement: Source-Grounding Verification and Privacy-Safe Recovery
All source-grounded curriculum nodes MUST verify their referenced document and passage/anchor locators against the local library. When a source document is modified or deleted, the system MUST perform deterministic local re-anchoring or surface explicit recovery options without fabricating ungrounded claims or transmitting `is_local_only` / `is_ai_excluded` content to cloud AI.

#### Scenario: Graceful recovery when a grounded source document is edited or deleted
- **GIVEN** a published Study Plan node grounded to a passage in document `D`
- **WHEN** document `D` is edited so the original character offset shifts, or document `D` is deleted
- **THEN** the grounding verifier MUST attempt deterministic local fingerprint re-anchoring when `D` exists and record `status = 'reanchored'` on match
- **AND** if `D` is deleted or the passage cannot be matched, the node MUST transition to `needs_grounding_repair` with explicit options to re-anchor, switch to an `alternative_explanation_of` source, or convert to an explicitly labelled ungrounded note

#### Scenario: Local-only and AI-excluded sources never reach cloud AI
- **GIVEN** a Study Plan grounded in a document marked `is_local_only = true` or `is_ai_excluded = true`
- **WHEN** prerequisite inference, adaptive progression, or grounding recovery runs
- **THEN** no document text, passage excerpt, or embedding payload from that document MUST be sent to any cloud AI provider
- **AND** deterministic local analysis and no-AI curriculum workflows MUST continue functioning without error
