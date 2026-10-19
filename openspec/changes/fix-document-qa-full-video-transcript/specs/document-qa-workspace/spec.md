## MODIFIED Requirements

### Requirement: Ordinary knowledge answers remain grounded in the selected sources

In `Document` and `Library` scopes, ordinary library/document knowledge questions SHALL use the grounded retrieval workflow for the displayed eligible scope while maintaining multi-turn conversation history so follow-up questions resolve references to prior turns and cited sources. In `Document` scope with a selected document, the selected document's available content (loaded text, transcript, focused section, or passage) SHALL be the primary evidence, and retrieval restricted to that document SHALL serve only as fallback when that content is unavailable or as coverage when the request exceeds the loaded window; the workspace SHALL NOT answer that the library lacks material while the selected document's content is available. When a turn's eligible sources resolve to exactly one video document (YouTube or local video), that document's complete persisted transcript SHALL be the primary evidence: the whole timestamped transcript when it fits the model's allocated source budget, otherwise a hierarchical full-transcript composition that covers every segment from start to end. The workspace SHALL NOT answer a single-video turn from a bounded set of retrieved transcript fragments while the complete transcript is available. When the complete transcript cannot be resolved for a single-video turn, the workspace SHALL attempt the canonical transcript fetch/backfill and persist it before answering; if the complete transcript still cannot be obtained, the workspace SHALL disclose the limitation honestly in `Document` and `Library` scopes and SHALL NOT present fragment-derived coverage as if it were the whole transcript. In `Chat` scope, the workspace SHALL use the selected source(s) as contextual grounding while permitting broader model knowledge and multi-turn exploration. Answer claims with citations SHALL refer to actual supplied evidence. Existing section/chapter requests, learning-item tool workflows (using the unified 4-stage tool-call parser), and explicit web-search questions SHALL retain their specialized behavior, include relevant conversation history, and accurately show their source context. Weak, conflicting, absent, or unavailable evidence SHALL be described honestly in `Document` and `Library` scopes; failure SHALL NOT silently produce an answer from unsupported general knowledge. Existing provider/privacy (`isAiExcluded`, `isLocalOnly`, and cloud AI disclosure) and retrieval-only behavior SHALL remain enforced.

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
- **AND** for a single-video turn the complete transcript is available to the answer, not only retrieved fragments

#### Scenario: Long video question is answered from the complete transcript

- **WHEN** the user asks a question whose evidence lies in the final minutes of a long video whose complete transcript exceeds the single-pass prompt budget while the video is the only eligible source
- **THEN** the answer reflects material from the complete transcript, including that late-video evidence, with `[MM:SS]` anchors
- **AND** the workspace does not state that it can only see a handful of provided chunks

#### Scenario: Over-budget single-video question composes the entire transcript hierarchically

- **WHEN** a single-video turn's complete transcript does not fit the model's source budget for a question that is not a summary request
- **THEN** the workspace composes window-level summaries across every segment from start to end and answers from that complete representation
- **AND** the response discloses its transcript coverage status honestly

#### Scenario: Missing video transcript is repaired or disclosed

- **WHEN** a single-video turn's stored transcript is absent or incomplete at question time
- **THEN** the workspace attempts the canonical transcript fetch/backfill and persists the complete transcript before answering
- **AND** if the complete transcript cannot be obtained, the response discloses the limitation instead of presenting partial fragments as the whole transcript or claiming the library lacks material

### Requirement: Evidence stays associated with its answer

Answers with structured citations SHALL expose readable source titles, supporting excerpts, and available locations through an expandable source region. A compact evidence summary SHALL show the submitted scope and actual distinct cited-document count when those facts are available. When an answer is grounded in a video document's transcript, the evidence summary SHALL identify that document and its available timestamp locations rather than reporting zero cited documents, and at least the grounded document SHALL be attributed when the answer used its supplied transcript as primary evidence. Citation numbering, answer/source association, and copy-with-sources behavior SHALL remain consistent after reload or source changes. Activating a resolvable citation SHALL open its cited passage through the existing reader navigation; unavailable locations SHALL have an honest fallback. Legacy answers SHALL NOT gain fabricated evidence metadata or duplicated source lists.

#### Scenario: Inspect and open evidence

- **WHEN** an answer cites passages from two documents and the user expands Sources
- **THEN** the actual cited titles and supporting excerpts are readable
- **WHEN** the user activates a resolvable source
- **THEN** the reader opens that document at the cited location

#### Scenario: Scope changes after an answer

- **WHEN** the user changes composer scope or reloads a saved conversation after receiving an answer
- **THEN** that answer retains its original evidence association and submitted-scope label when saved
- **AND** copying it includes its own sources rather than the current composer's sources

#### Scenario: Citation location is unavailable

- **WHEN** a cited passage cannot be located or its document no longer exists
- **THEN** the source remains honestly identified with an unavailable-location explanation
- **AND** the interface does not navigate to a guessed passage

#### Scenario: Video-grounded answer attributes its document

- **WHEN** an answer is produced for a single-video turn from that video's complete transcript
- **THEN** the evidence region identifies the video document, with timestamped locations where the answer references specific passages
- **AND** the compact evidence summary does not report zero cited documents while the answer was grounded in that transcript
