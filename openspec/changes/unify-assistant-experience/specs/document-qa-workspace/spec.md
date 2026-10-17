## ADDED Requirements

### Requirement: Workspace expands the same Assistant conversation

The research workspace SHALL open an existing Assistant conversation by stable ID with the same history, per-turn source policy/evidence, draft and saved artifact references. Returning to the contextual sidebar SHALL retain that identity and relevant view state. Existing research editing, document/section mentions, source picker, history, learning tools and linked NotebookLM research artifacts SHALL remain available in their appropriate workspace presentation.

#### Scenario: Expand and collapse without starting over
- **GIVEN** the sidebar has a grounded conversation with an unsent section-mentioned draft
- **WHEN** the user expands into Document Q&A and returns to the reader
- **THEN** the conversation, draft and original citations remain intact
- **AND** expanding does not create a duplicate history or replay saved actions

#### Scenario: Linked research tools remain available
- **GIVEN** a workspace conversation has a linked research draft and accepted study artifacts
- **WHEN** it is opened through canonical History
- **THEN** its research editing and saved artifact links remain available
- **AND** the compact sidebar/mobile presentation does not have to mount the full editor

### Requirement: Canonical entry intents preserve palette behavior

Ask about this document, Ask my library, Explain selected text and Compare these documents SHALL hand question, exact source/selection context, restriction and optional existing conversation identity into the canonical conversation lifecycle. Handoffs SHALL be acknowledged once only after durable preparation and SHALL not auto-submit. Outgoing drafts SHALL be saved before replacing a prepared entry. Existing navigation, related-document search, product help, registry commands and keyboard behavior SHALL remain unchanged.

#### Scenario: Library question from palette
- **GIVEN** the user has an existing conversation draft
- **WHEN** they choose a library-question suggestion from the command palette
- **THEN** the palette closes and the canonical workspace opens with the complete editable question and visible library restriction
- **AND** the prior draft is retained, delayed mounting does not duplicate the handoff, and generation waits for Ask

#### Scenario: Compare selected documents
- **GIVEN** two eligible documents are selected in a supported entry surface
- **WHEN** the user activates Compare these documents
- **THEN** both real source IDs and an editable comparison question enter one canonical conversation
- **AND** no other source is silently substituted

### Requirement: Desktop reading remains usable beside conversation

Desktop SHALL provide open/close, click/keyboard-accessible resize or width controls, readable long answers, source attachments, history and citations alongside the reader within existing minimum widths. Closing/expanding SHALL preserve draft and reading position. Focus, 200% zoom, narrow layouts, IME submission and reduced motion SHALL retain the existing accessibility guarantees.

#### Scenario: Resize and keyboard navigation
- **GIVEN** the reader and contextual sidebar are open
- **WHEN** the user changes panel width, browses sources by keyboard and closes/reopens it
- **THEN** the reader retains a usable width and position, focus returns appropriately and the same conversation/draft is restored
- **AND** source inspection does not require dragging or hover-only controls
