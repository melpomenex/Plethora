## MODIFIED Requirements

### Requirement: Evidence-based coverage with hedged language

For each proposed prerequisite the system SHALL query actual library chunks, extracts, annotations, cards and relevant activity records, validate source identity/revision and produce deterministic evidence coverage with navigable references. Evidence coverage SHALL distinguish not covered by indexed evidence, partially covered, supported by identifiable sources and unknown because relevant evidence is not indexed or cannot be queried. Index completeness SHALL be shown independently. Legacy none/encountered/studied/reviewed activity SHALL remain separate from evidence coverage and SHALL NOT imply mastery.

The model SHALL NOT invent evidence IDs, determine coverage from its own rationale or claim what the user knows. The UI SHALL use hedged evidence/activity language. Canonical names SHALL deduplicate case/whitespace variants without silently merging synonyms.

#### Scenario: Coverage summary
- **WHEN** three of four prerequisites have verified supporting cards
- **THEN** the UI can state that cards cover three of four prerequisites, links to each source and makes no claim of user mastery

#### Scenario: Missing prerequisite surfaced
- **WHEN** a complete successful indexed-evidence search finds no support for a prerequisite
- **THEN** the UI says it is not covered by indexed evidence without asserting the user lacks the knowledge

#### Scenario: Unindexed evidence remains unknown
- **WHEN** relevant library material is unindexed, stale or unavailable and no support is verified
- **THEN** coverage is unknown with an indexing/retry explanation rather than not-covered

#### Scenario: Mention without direct support
- **WHEN** verified text mentions the concept but contains no qualifying direct support
- **THEN** coverage is partial and the actual mentioning source is inspectable

#### Scenario: Stale or fabricated evidence
- **WHEN** an evidence ID cannot be resolved or its source has changed
- **THEN** it does not count as current support and the UI reports the limitation

#### Scenario: Canonical spelling and empty inference
- **WHEN** inference returns case/whitespace variants or no prerequisites
- **THEN** variants share one concept result and an empty result states only that no prerequisites were suggested

### Requirement: Typed concept links with confidence and provenance

The system SHALL maintain canonical concepts and existing typed links (same-as, prerequisite-of, example-of, contradicts, supports, extends, analogous-to, definition-of, application-of, related-to) in its relational representation with confidence, validated provenance and original creator. AI suggestions SHALL remain drafts until the user explicitly saves suggestions or accepts them; they SHALL respect per-relation thresholds, five-per-analysis and existing daily caps. Saved pending suggestions and confirmed relationships SHALL remain visibly distinct.

Users SHALL accept, dismiss, edit and remove links; dismissal SHALL remember the canonical fingerprint and prevent identical re-proposals. Acceptance SHALL preserve AI origin while recording user endorsement. Endpoint existence, relation validity, confidence and uniqueness SHALL be enforced at persistence boundaries. Coverage and authoritative graph relationships SHALL exclude unconfirmed suggestions.

#### Scenario: Link suggestion with provenance
- **WHEN** the user inspects an AI-proposed link
- **THEN** relation, confidence, actual sources, origin and pending status are visible with explicit save/accept/dismiss actions

#### Scenario: Dismissed proposals are not re-proposed
- **WHEN** the user dismisses a proposal and repeats the same analysis after restart
- **THEN** the same fingerprint is suppressed

#### Scenario: User control over durable links
- **WHEN** the user edits or removes a saved link
- **THEN** the change is validated and reflected in backlinks, or the original remains visible with a recoverable failure

#### Scenario: Concurrent duplicate acceptance
- **WHEN** two views save the same canonical relationship concurrently
- **THEN** one durable relationship exists and both views resolve to it

#### Scenario: Untrusted endpoint or over-cap response
- **WHEN** a suggestion references a missing endpoint, invalid confidence or exceeds the analysis cap
- **THEN** invalid links are rejected before persistence and no orphan concept is created

#### Scenario: Flag independence
- **WHEN** prerequisites are enabled but concept links are disabled
- **THEN** prerequisite evidence remains available and no relationship proposal or write occurs

### Requirement: Related-content discovery

Related-content and concept backlinks SHALL combine the shared retrieval layer with validated concept links rather than a second index. Users SHALL navigate to supporting documents, extracts and cards from prerequisite results and existing knowledge interfaces. Stale/deleted evidence and semantic/lexical limitations SHALL be visible. Explicit analysis SHALL be cancellable and satisfy destination consent before remote query processing.

#### Scenario: Find related on a selection
- **WHEN** the user explicitly requests related material for a passage
- **THEN** bounded results from shared retrieval and concept links include verified navigable references

#### Scenario: Cross-document backlink
- **WHEN** the user accepts a supported relationship between concepts associated with two documents
- **THEN** concept detail and graph interfaces show the confirmed relationship and navigate to both supporting sources

#### Scenario: Deleted source
- **WHEN** a linked document is removed or its locator becomes stale
- **THEN** the relationship is marked stale, cannot count as current evidence and offers reanalysis or removal

#### Scenario: Analysis cancelled or cloud denied
- **WHEN** the user cancels, changes source or declines required remote-query authorization
- **THEN** no further queries or writes occur and late results cannot replace the active analysis
