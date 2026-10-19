## MODIFIED Requirements

### Requirement: Questions resolve to passage, document, or library scope

Every question SHALL resolve to exactly one scope: Passage (the selected or edited chip text), Document (the current document), or Library (all indexed library content). Passage scope SHALL use only the chip text as context. Document scope SHALL answer from the active document's available content — loaded document text, focused section, canonical transcript, or selected passage — before consulting the index, and SHALL retrieve document-restricted chunks only when that content is unavailable or when the request needs coverage beyond the loaded window; retrieval in Document scope SHALL remain restricted to the active document and SHALL never widen to the rest of the library. Library scope SHALL retrieve relevant chunks via the semantic index across the permitted library before generating an answer.

#### Scenario: Scope picker changes retrieval breadth

- **WHEN** the user switches the scope picker from Passage to Library and submits the same question
- **THEN** the answer is produced from retrieval across the library index rather than only the selected passage

#### Scenario: Passage scope uses only the selected text

- **WHEN** the scope is Passage
- **THEN** no library retrieval is performed
- **AND** the answer is grounded only in the passage text

#### Scenario: Document scope grounds in the open document

- **WHEN** the scope is Document, the current document's content is available, and the document has no usable indexed chunks
- **THEN** the answer is produced from the current document's available content, restricted to that document
- **AND** no library-wide retrieval or library-empty claim is produced
