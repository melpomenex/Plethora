# Study Mode Foundation Specification

## ADDED Requirements

### Requirement: Canonical Study Mode Session and Artifact Persistence
The system SHALL persist optional `study_mode_sessions` and `study_mode_artifacts` in SQLite supporting both standalone source scopes (`standalone_document`, `standalone_selection`) and Study Plan scopes (`study_plan_topic`, `study_plan_segment`), recording `source_revision`, `knowledge_authority`, `anchors_json`, `preference_fingerprint`, `task_id`, `provider_id`, `model_id`, `validation_status`, `is_stale`, and `is_locked`.

#### Scenario: Standalone document Study Mode without creating a Study Plan
- **WHEN** a learner activates Study Mode on a document outside any Study Plan
- **THEN** a `study_mode_sessions` record is created with `scope_kind = 'standalone_document'` and `study_plan_id = NULL`
- **AND** no `study_plans` record is created.

#### Scenario: Source revision change marks artifacts stale without deleting history
- **WHEN** a source document's `content_hash` or content revision changes after Study Mode artifacts were generated
- **THEN** matching `study_mode_artifacts` are marked `is_stale = 1`
- **AND** historical `learning_evidence` and `exam_attempts` remain intact.

### Requirement: Zero Automatic Overhead When Inactive
Opening or importing a document SHALL NOT automatically create `study_mode_sessions`, generate `study_mode_artifacts`, or trigger educational AI requests.

#### Scenario: Ordinary document open
- **WHEN** a user opens a document without explicitly activating Study Mode
- **THEN** zero Study Mode AI requests are issued and zero `study_mode_artifacts` rows are created.

### Requirement: Authoritative Source Grounding and Extract Scope Enforcement
Source resolution SHALL verify `#occ:N` disambiguated chunk IDs consistently with the semantic indexer, and Study Trail segment generation SHALL restrict candidate documents and extracts to `selected.extractIds` when extract scoping is provided.

#### Scenario: Duplicate-text chunk verification
- **WHEN** a PDF or EPUB contains repeated identical paragraphs indexed with `#occ:N` suffixes
- **THEN** `verify_chunk_ref` resolves the `#occ:N` chunk without false `chunk_not_in_live_source` rejection.
