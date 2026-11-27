# Source-Aware Study Scopes Specification

## ADDED Requirements

### Requirement: Source-Aware Scope Selection and Defaults
Study Mode SHALL present an unobtrusive scope selector showing only scope options meaningful for the active document (such as current section, current chapter, selected passage, PDF page/range, media/transcript segment, entire document, or Study Plan assignment). Entering Study Mode from selected text SHALL default to the selected passage; from a Study Plan SHALL default to the assigned topic/segment; and from ordinary reading SHALL default to the current meaningful section.

#### Scenario: PDF document offers page/range and document scopes without chapter clutter when no outline exists
- **GIVEN** a user enters Study Mode from page 12 of a PDF with no outline
- **WHEN** the scope selector opens
- **THEN** it offers the current PDF page/range and entire document scopes
- **AND** it resolves bounded text from the live PDF context rather than empty `currentDocument.content`.

#### Scenario: Selected text scopes Study Mode to the selection
- **GIVEN** a user selects a passage in the reader and enters Study Mode
- **WHEN** Study Mode initializes
- **THEN** the active scope defaults to the selected passage
- **AND** the user can switch back to section or document scope explicitly.

### Requirement: Bounded Model Context and Consent Preservation
Study Mode SHALL assemble bounded, token-budgeted source evidence for AI tasks and SHALL NOT indiscriminately transmit an entire large book or transcript. Scope changes SHALL NOT silently broaden local-only or cloud-provider authorization.

#### Scenario: Large document is bounded within context budget
- **GIVEN** a document whose full text exceeds the study context budget
- **WHEN** the user requests an explanation, concept map, or practice question
- **THEN** the assembled passage context stays within the configured character/token budget
- **AND** partial entire-document retrieval is labeled honestly rather than claimed as complete coverage.

### Requirement: Revision-Independent Scope Identity and Accurate Evidence Persistence
Artifact and session `scope_key` values SHALL uniquely identify document/plan, scope kind, and canonical scope target independently of `sourceRevision` so different chapters/passages never collide and `sourceRevision` changes accurately mark prior artifacts stale. Authoritative formative submissions (when not `model-only`) SHALL persist real records to `learning_evidence`.

#### Scenario: Different sections maintain isolated artifacts and sessions
- **GIVEN** a user generates an explanation in Chapter 1 and switches scope to Chapter 2
- **WHEN** the workspace loads Chapter 2
- **THEN** Chapter 1's artifacts do not collide with Chapter 2
- **AND** returning to Chapter 1 restores Chapter 1's cached artifacts without regenerating.

#### Scenario: Formative submission records learning evidence
- **GIVEN** a learner submits an answer to a persisted formative question in `source-only` mode
- **WHEN** the backend grades the submission
- **THEN** a valid `practice-check` row is persisted in `learning_evidence` with `evidence_recorded = true`
- **AND** FSRS `learning_items` scheduling state is not modified.

### Requirement: Verified Citation Navigation to Canonical Reader
Clicking a citation anchor in any Study Mode activity SHALL reveal the canonical source viewer (in `"with-source"` layout) and navigate to the verified EPUB CFI, PDF page, HTML/Markdown passage, or media timestamp while preserving the active Study Mode activity. Unresolvable citations SHALL show an honest recovery notice without jumping to an unrelated passage.

#### Scenario: Clicking a citation navigates the canonical reader
- **GIVEN** an explanation or concept map node contains a verified source citation
- **WHEN** the user activates the citation chip
- **THEN** the canonical reader opens in `"with-source"` layout and navigates to the cited location
- **AND** the active Study Mode activity remains open and intact.
