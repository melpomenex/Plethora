## MODIFIED Requirements

### Requirement: Honest handling of weak or missing evidence

When retrieval yields no or weak evidence in `Library` scope, the system SHALL say that the library does not appear to cover the question instead of fabricating an answer. When document-restricted retrieval yields no evidence in `Document` scope, the system SHALL say that the active document does not contain the evidence and SHALL NOT claim that the library lacks material; if the active document's own content is available, the system SHALL answer from that content rather than presenting a retrieval-empty outcome. Conflicting sources SHALL be reported as conflicting. When validating cited quotes against retrieved source chunks, the validator SHALL tolerate minor punctuation, ellipsis (`...`), and whitespace normalization differences so genuinely grounded citations are not falsely discarded and downgraded to `evidenceLevel: "none"`.

#### Scenario: Unanswerable query
- **WHEN** the library contains no material relevant to the question in `Library` scope
- **THEN** the system responds that the library does not appear to cover it (and offers switching to `Chat` scope) rather than generating an unsupported answer

#### Scenario: Document-scope empty retrieval does not claim library-wide absence
- **WHEN** `Document` scope retrieval restricted to the active document returns no chunks
- **AND** the active document's content is unavailable or does not address the question
- **THEN** the system says the active document does not contain the evidence and offers switching to `Chat` scope
- **AND** it does not say that the library lacks material

#### Scenario: Conflicting sources
- **WHEN** retrieved sources disagree
- **THEN** the answer presents the conflict with citations instead of silently choosing a side

#### Scenario: Grounded quote with minor punctuation or ellipsis normalization
- **WHEN** the model cites a valid chunk ID and provides a quote that matches the chunk text across normalized clauses separated by an ellipsis (`...`) or typographic punctuation
- **THEN** the citation is accepted as grounded and `evidenceLevel` remains `"supported"`
