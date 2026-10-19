## MODIFIED Requirements

### Requirement: Document scope enforces strict source grounding

When `Document` scope is active, the Assistant SHALL answer strictly from evidence supplied by the active document, video transcript, mentioned sections, or selected passage. Evidence already resolved from the active source (the loaded document text, the focused section, the canonical transcript, or a captured selection) SHALL take precedence over index retrieval: a `Document`-scope turn SHALL NOT be answered from retrieval — or be replaced by a retrieval-empty outcome — while active-source evidence is available. When no active-source evidence is available, the Assistant SHALL attempt retrieval restricted to the active document's permitted sources; that retrieval is a fallback and SHALL NOT widen beyond the active document. The Assistant SHALL NOT silently supplement answers with unsupported general model knowledge. When neither the active source's available evidence nor document-restricted retrieval supplies sufficient evidence, the Assistant SHALL state that the active document does not contain the evidence, SHALL NOT claim that the library lacks material, and SHALL offer a one-click action to re-ask or continue in `Chat` scope. When an answer is generated from only a bounded window of a longer source (for example the region around the reader's position), the response SHALL disclose that partial coverage rather than presenting the answer as covering the whole source.

#### Scenario: Strictly grounded answer in Document scope
- **WHEN** the user selects `Document` scope and asks a question covered by the active source
- **THEN** the Assistant answers using only the active source evidence and attaches resolvable citations or timestamps

#### Scenario: Open document answers without an index entry
- **WHEN** the active document's text is loaded and visible while the document has no usable indexed chunks (never indexed, index stale, or retrieval misses)
- **THEN** the Assistant answers from the loaded document text
- **AND** it does not respond that the library does not contain the material, and does not ask the user to switch scopes, while the document text is available

#### Scenario: Missing evidence in Document scope offers Chat scope expansion
- **WHEN** the user selects `Document` scope and neither the active source's available evidence nor document-restricted retrieval addresses the question
- **THEN** the Assistant states that the active document does not contain the answer without guessing from general knowledge
- **AND** the response provides an action to switch to `Chat` scope to answer using broader knowledge

#### Scenario: Window-limited answer discloses partial coverage
- **WHEN** the active source is longer than the resolved prompt budget and the answer is generated from a bounded window of it
- **THEN** the request records window coverage
- **AND** the answer does not claim to summarize or exhaust the whole source
