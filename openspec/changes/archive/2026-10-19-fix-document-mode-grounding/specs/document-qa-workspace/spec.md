## MODIFIED Requirements

### Requirement: Ordinary knowledge answers remain grounded in the selected sources

In `Document` and `Library` scopes, ordinary library/document knowledge questions SHALL use the grounded retrieval workflow for the displayed eligible scope while maintaining multi-turn conversation history so follow-up questions resolve references to prior turns and cited sources. In `Document` scope with a selected document, the selected document's available content (loaded text, transcript, focused section, or passage) SHALL be the primary evidence, and retrieval restricted to that document SHALL serve only as fallback when that content is unavailable or as coverage when the request exceeds the loaded window; the workspace SHALL NOT answer that the library lacks material while the selected document's content is available. In `Chat` scope, the workspace SHALL use the selected source(s) as contextual grounding while permitting broader model knowledge and multi-turn exploration. Answer claims with citations SHALL refer to actual supplied evidence. Existing section/chapter requests, learning-item tool workflows (using the unified 4-stage tool-call parser), and explicit web-search questions SHALL retain their specialized behavior, include relevant conversation history, and accurately show their source context. Weak, conflicting, absent, or unavailable evidence SHALL be described honestly in `Document` and `Library` scopes; failure SHALL NOT silently produce an answer from unsupported general knowledge. Existing provider/privacy (`isAiExcluded`, `isLocalOnly`, and cloud AI disclosure) and retrieval-only behavior SHALL remain enforced.

#### Scenario: Selected-document knowledge answer
- **WHEN** the user asks an ordinary knowledge question with one document selected in `Document` or `Library` scope and follows up referring to the previous answer
- **THEN** the answer uses the selected document's available content, with retrieval restricted to that document only when needed, while resolving follow-up references across turns
- **AND** any displayed citations refer to actual supporting passages

#### Scenario: Selected document is not indexed
- **WHEN** `Document` scope has one selected document whose text is available but whose chunks are not in the semantic index
- **THEN** the answer is produced from the selected document's text
- **AND** the workspace does not report that the library lacks relevant material

#### Scenario: Matching evidence is insufficient
- **WHEN** the selected document's content and document-restricted retrieval provide weak or no supporting evidence in `Document` scope, or retrieval across the library does so in `Library` scope
- **THEN** the result explains the limitation, allows question/source refinement, and offers to continue in `Chat` scope
- **AND** it does not claim an exhaustive search or invent support

#### Scenario: Expert section or tool workflow
- **WHEN** the user explicitly targets a chapter/section or requests the existing flashcard formulation workflow across multiple turns or in `Library` scope
- **THEN** its established focused context, real source retrieval, 4-stage tool parsing, card creation, and saved-result behavior continue to work
- **AND** the workspace does not invent citation metadata for a response that has none

#### Scenario: YouTube document in Document Q&A uses canonical transcript
- **WHEN** the user selects a YouTube video document in Document Q&A whose transcript was fetched via on-device InnerTube or the video viewer
- **THEN** Document Q&A resolves the persisted canonical transcript and timestamps for retrieval and section/context answering
