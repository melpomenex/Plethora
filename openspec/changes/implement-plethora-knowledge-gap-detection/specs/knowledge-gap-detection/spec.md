## ADDED Requirements

### Requirement: Gap detection covers defined gap kinds with explicit rules
The system SHALL detect at least: weak prerequisite, missing concept, repeatedly failed, read-but-never-reviewed, disconnected cluster, and weak transfer — each via documented rules over review history, semantic coverage, graph relations, assessment outcomes, and reading activity. Detection SHALL be incremental background work under idle/battery gates, never blocking reading or review.

#### Scenario: Weak prerequisite detected
- **WHEN** the fixture user actively studies virtual-memory concepts whose `prerequisite-of` target (TLB) shows weak mastery
- **THEN** a `weak_prerequisite` gap is produced with the dependency edge as evidence

#### Scenario: Read-never-reviewed surfaces
- **WHEN** a document was fully read 30+ days ago and produced no extracts, cards, or reviews
- **THEN** a `read_never_reviewed` gap lists the document with its activity evidence

### Requirement: Every gap is explainable and disputable
Each gap SHALL carry evidence records (review results, unreviewed chunks, graph edges with citations, assessments) and the fired rule. Users SHALL be able to inspect evidence and suppress a gap as not-applicable (suppression persisted; gaps re-evaluated when materially new evidence arrives).

#### Scenario: Evidence resolves
- **WHEN** the user opens "why" for a repeatedly-failed gap
- **THEN** the failing review results and affected items are listed and each links to its source/record

#### Scenario: Suppression honored
- **WHEN** a user suppresses a gap
- **THEN** it disappears from surfaces and is not re-surfaced unless new evidence of a different rule fires

### Requirement: Mastery estimates express uncertainty
Concept-level mastery SHALL be presented as an estimate with variance/level (not a precise score), blending FSRS retrievability, assessments, coverage, and recency. UI language SHALL remain probabilistic (no certainty claims about the user's knowledge).

#### Scenario: Estimate reflects evidence strength
- **WHEN** mastery is computed from sparse evidence
- **THEN** the surfaced estimate shows wide uncertainty rather than a confident value

### Requirement: Actions route to concrete remediation
Each gap SHALL offer Explain, Teach me (proposal 12 with gap context), Find material (library + existing web/arXiv search), Generate practice / Make cards (proposal 13), and Dismiss. Actions open with the gap's evidence as context.

#### Scenario: Teach-me carries context
- **WHEN** the user taps Teach me on a gap
- **THEN** the tutor opens pre-loaded with the gap's concept, evidence summary, and related sources

### Requirement: Local-first with capability-gated model analysis
Rule-based detection and mastery estimation SHALL run locally for all users. LLM-assisted reasoning SHALL require `knowledge_gap_detection`, run as jobs over compact evidence summaries (not raw library content), honor AI-exclusion flags, and disclose data flow.

#### Scenario: Evidence summaries only
- **WHEN** cloud gap analysis runs
- **THEN** payloads contain aggregated evidence summaries, not full document texts

### Requirement: No mid-session interruption
Gap surfaces SHALL NOT interrupt active review sessions or reading focus; post-session summary lines are the only session-adjacent surface, limited to one per session.

#### Scenario: Session stays clean
- **WHEN** repeated failures occur mid-session
- **THEN** no gap UI appears until the session ends, and at most one summary line shows after
