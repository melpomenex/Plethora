# assistant-conversation-scopes Specification

## Purpose
Provides a unified conversational learning companion with three explicit, user-selectable scopes (`Chat`, `Document`, and `Library`), multi-turn conversational continuity across scope and document transitions, and non-blocking general dialogue even when source material is absent or unextracted.

## Requirements

### Requirement: Three explicit user-selectable conversational scopes
The Assistant SHALL expose three explicit top-level scopes—`Chat`, `Document`, and `Library`—adjacent to the conversation composer across supported Assistant surfaces. `Chat` SHALL be the default scope for newly created ordinary conversations unless launched from an explicit entry point that targets strict document or library Q&A. The active scope SHALL remain visible at all times and SHALL NOT automatically switch to `Document` merely because a document or video is open.

#### Scenario: Newly opened Assistant defaults to Chat scope
- **WHEN** the user opens a document or video and opens a new Assistant conversation without selecting a strict Q&A entry point
- **THEN** the scope selector defaults to `Chat`
- **AND** the active document or video is shown as contextual grounding rather than a strict conversational boundary

#### Scenario: Explicit Library Q&A entry point selects Library scope
- **WHEN** the user activates "Ask about your library" from the command palette
- **THEN** the conversation opens with `Library` scope selected and visible

### Requirement: Chat scope enables unrestricted context-aware learning dialogue
When `Chat` scope is active, the Assistant SHALL answer any question the user asks, treating the active document, video transcript, or text selection as an optional contextual asset rather than a boundary on allowable topics. The Assistant SHALL draw on broader model knowledge when the user asks general, comparative, or tangential questions, SHALL cite the active source when making source-specific claims, and SHALL NEVER fabricate quotations, passages, timestamps, or citations.

#### Scenario: Unrelated general-knowledge question on the first turn
- **WHEN** the user opens a research paper and immediately asks an unrelated general-knowledge question on the first turn in `Chat` scope
- **THEN** the Assistant answers the question directly using model knowledge without refusing or claiming the answer is absent from the document

#### Scenario: Natural transition from document content to external topic
- **WHEN** the user asks "Explain the attention mechanism in this paper" and follows up with "How is this different from human attention in neuroscience?" in `Chat` scope
- **THEN** the Assistant grounds the first answer in the paper and answers the follow-up by connecting the paper's concepts with broader neuroscience knowledge in the same continuous conversation

#### Scenario: Chat scope functions when source extraction is unavailable
- **WHEN** the user is on a non-document view or opens a PDF/video whose text or transcript is unavailable or still loading
- **AND** the user asks a general question in `Chat` scope
- **THEN** the Assistant answers normally without throwing a missing-context error or blocking submission

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

### Requirement: Library scope performs multi-turn cross-source retrieval
When `Library` scope is active, the Assistant SHALL retrieve relevant evidence across eligible indexed documents, extracts, annotations, flashcards, and transcripts, synthesize answers with numbered source citations, and preserve multi-turn conversational continuity across follow-up questions.

#### Scenario: Follow-up reference resolution in Library scope
- **WHEN** the user asks a question in `Library` scope that cites two documents and follows up with "Compare the methodology in the second paper with the first"
- **THEN** the Assistant resolves "the second paper" and "the first" from the prior turn's history and cited sources, retrieves supporting chunks as needed, and answers with grounded citations

### Requirement: Scope switching preserves conversation history and session state
Switching between `Chat`, `Document`, and `Library` scopes within an active conversation SHALL preserve the existing message thread, unsent draft, and created learning artifacts. Each persisted message SHALL record the scope under which it was generated, and the active scope selection SHALL be persisted with the conversation session.

#### Scenario: Switching from Chat to Document and back within one thread
- **WHEN** the user starts in `Chat` scope, switches to `Document` scope for a strictly grounded verification question, and switches back to `Chat` scope for open-ended synthesis
- **THEN** all turns remain in a single continuous conversation thread
- **AND** each turn applies the grounding policy of the scope selected at submission time without discarding prior context

### Requirement: Document switching prevents stale source context leakage
When the user switches the active document or video while continuing a conversation, or detaches an active source context chip, the Assistant SHALL bind subsequent source-grounded claims to the newly active or explicitly attached source and SHALL NOT attribute claims from the previous document's raw context excerpt to the new document.

#### Scenario: Switching active document mid-conversation
- **WHEN** the user discusses Document A, opens Document B, and asks "What is the main thesis of this document?"
- **THEN** the Assistant resolves "this document" against Document B's content without leaking Document A's unreferenced context excerpt

### Requirement: Multi-turn study tool execution across scopes
In `Chat`, `Document`, and `Library` scopes, the Assistant SHALL preserve access to learning tools (flashcard creation, cloze creation, extract creation, and `/20rules` formulation) and SHALL synthesize concepts discussed across multiple conversation turns when requested by the user.

#### Scenario: Flashcard creation from multi-turn discussion
- **WHEN** the user discusses a source concept and its broader implications across four turns and then asks "Create five flashcards covering the most important connections we discussed"
- **THEN** the Assistant invokes the card creation tool using context from the multi-turn conversation and renders the resulting flashcard artifacts inline
