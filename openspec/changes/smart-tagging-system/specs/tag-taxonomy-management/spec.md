# tag-taxonomy-management Specification

## ADDED Requirements

### Requirement: Preference for existing user taxonomy
Smart Tagging SHALL prioritize reusing existing tags from the user's library over generating new synonymous tags. When classifying a new document, the system SHALL retrieve candidate tags from the user's existing taxonomy and evaluate whether incoming concepts align with those candidates.

#### Scenario: Existing tag reuse prevents synonym creation
- **GIVEN** a user's library already contains the tag `Machine Learning`
- **WHEN** a document discussing machine learning algorithms is imported
- **THEN** the tagger selects the existing tag `Machine Learning`
- **AND** does NOT generate new redundant tags such as `ML`, `Machine-Learning`, or `AI / ML`

#### Scenario: Bounded candidate tag retrieval
- **GIVEN** a user library containing 5,000 distinct tags
- **WHEN** Smart Tagging generates candidate tags for an imported document
- **THEN** the system retrieves a ranked subset of the top 30 relevant candidates based on lexical matching, term co-occurrence, and library frequency
- **AND** passes only this bounded candidate set to the classifier

### Requirement: Semantic duplicate detection and normalization
Before creating any new tag, Smart Tagging SHALL check for equivalence against existing tags using case-insensitive normalization, singular/plural heuristics, punctuation/hyphenation stripping, and known abbreviation mapping.

#### Scenario: Case and hyphenation normalization
- **GIVEN** an existing tag `Computer Science`
- **WHEN** the classifier suggests `computer-science` or `COMPUTER SCIENCE`
- **THEN** the system resolves the candidate to the existing `Computer Science` tag
- **AND** does NOT create a duplicate tag entry

#### Scenario: Singular vs plural consolidation
- **GIVEN** an existing tag `Operating System`
- **WHEN** the classifier suggests `Operating Systems`
- **THEN** the system matches the existing tag and applies `Operating System`

### Requirement: Authoritative user tags and non-destructive operations
User-created and manually assigned tags SHALL remain authoritative. Smart Tagging SHALL NEVER automatically delete, rename, or destructively merge tags that the user explicitly created or assigned.

#### Scenario: Manual tags preserved during automatic tagging
- **GIVEN** a document with manually assigned tags `[MyProject, Urgent]`
- **WHEN** Smart Tagging executes (or re-executes) on the document
- **THEN** the tags `MyProject` and `Urgent` are strictly preserved
- **AND** newly inferred high-confidence tags are merged additively

#### Scenario: Manual removal prevents automated re-addition
- **GIVEN** Smart Tagging previously assigned `Physics` to a document
- **WHEN** the user manually removes the `Physics` tag from the document
- **THEN** future automated retagging passes SHALL NOT re-apply `Physics` to that document unless explicitly requested

### Requirement: Tag provenance and explainability
The system SHALL record provenance for every tag assignment (`manual`, `smart-local`, `smart-llm`) and retain a concise, human-readable reason for automated assignments. The system SHALL NOT store or expose raw chain-of-thought tokens.

#### Scenario: Tag inspector displays provenance and reason
- **GIVEN** a document tagged `CPU Scheduling` by Smart Tagging
- **WHEN** the user inspects the tag in the document details or tag popover
- **THEN** the UI indicates the provenance (e.g. `Smart Tag (AI)` or `Smart Tag (Local)`)
- **AND** displays the concise reason (e.g. `"Discusses Linux Completely Fair Scheduler and process priority"` )

### Requirement: Item-level retagging and tag cleanup
The system SHALL provide explicit actions allowing users to re-run Smart Tagging on an individual document or review automatically generated tags.

#### Scenario: Per-item Retag action
- **GIVEN** a document previously tagged with obsolete or legacy heuristics
- **WHEN** the user triggers the "Retag Document" action
- **THEN** Smart Tagging re-evaluates the document content using the current active engine
- **AND** replaces previous automated tags with current high-confidence tags while preserving manual user tags
