## ADDED Requirements

### Requirement: Prerequisite inference

Given difficult material (typically a selection), the system SHALL propose plausible
prerequisite concepts as a structured, validated analysis.

#### Scenario: Prerequisites for advanced material
- **WHEN** a user invokes "find prerequisites" on a passage about the CFL pumping lemma
- **THEN** proposed prerequisites may include regular-language pumping lemma, context-free
  grammars, parse trees, and proof by contradiction

### Requirement: Evidence-based coverage with hedged language

For each proposed concept the system SHALL search the user's existing material (chunks,
extracts, notes, cards, review history) and produce an evidence-based coverage level
(none/encountered/studied/reviewed) with source references. The system SHALL use hedged
language (coverage, evidence, familiarity estimate, apparent gap) and SHALL NOT claim
knowledge of what the user knows.

#### Scenario: Coverage summary
- **WHEN** three of four proposed prerequisites are covered by existing cards and reads
- **THEN** the UI can state "you have cards covering 3 of these 4 prerequisites" with links to
  the evidence

#### Scenario: Missing prerequisite surfaced
- **WHEN** one prerequisite has no evidence in the library
- **THEN** the UI identifies it as an apparent gap without asserting the user lacks the
  knowledge

### Requirement: Typed concept links with confidence and provenance

The system SHALL maintain concept entities and typed links (same-as, prerequisite-of,
example-of, contradicts, supports, extends, analogous-to, definition-of, application-of,
related-to) in a relational representation with embeddings, carrying confidence, provenance,
and creator (AI or user). AI-proposed links SHALL appear as inspectable suggestions above a
per-relation confidence threshold, with caps per analysis to prevent graph spam.

#### Scenario: Link suggestion with provenance
- **WHEN** an AI-proposed link is inspected
- **THEN** the user sees its relation type, confidence, provenance (what analysis proposed it,
  from which sources), and can accept or dismiss it

#### Scenario: Dismissed proposals are not re-proposed
- **WHEN** a user dismisses a proposed link
- **THEN** the same proposal is not re-surfaced later

#### Scenario: User control over durable links
- **WHEN** an AI-created durable link exists
- **THEN** the user can inspect and remove it at any time

### Requirement: Related-content discovery

Concept linking SHALL power related-content suggestions (related extracts, cards, documents)
and backlinks on concept pages, built on the shared semantic retrieval layer rather than a
second search system.

#### Scenario: Find related on a selection
- **WHEN** a user invokes "find related" on a passage
- **THEN** results come from the semantic index plus concept links with navigable references

### Requirement: Passage extract-worthiness

The system SHALL optionally classify passages (fundamental claim, definition, important
example, key argument, formula, process, comparison, supporting detail, transition,
bibliography, low value) with an extract-worthiness score, suggested action, and reason.
Scoring SHALL be computed on demand for recently read viewport content (not pre-computed for
whole documents), cached by chunk hash, surfaced only above a high threshold as an unobtrusive
margin indicator, and fully disableable.

#### Scenario: High-worth passage indicator
- **WHEN** a read passage scores above the indicator threshold
- **THEN** a subtle margin indicator appears with one-tap conversion into an extract/card
  candidate

#### Scenario: Bibliography stays quiet
- **WHEN** the user reads bibliography or transition passages
- **THEN** no worthiness indicators appear

#### Scenario: Feature disabled
- **WHEN** the user disables extract suggestions
- **THEN** no scoring runs and no indicators appear anywhere
