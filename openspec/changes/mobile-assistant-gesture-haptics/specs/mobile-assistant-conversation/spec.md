## Purpose

Preserve one mobile Assistant conversation across presentation and active-view changes while reusing established scope, source, privacy and selection-question behavior.

## ADDED Requirements

### Requirement: Global conversation survives presentation changes
The mobile Assistant SHALL preserve messages, draft and selected scope across partial/expanded transitions, dismissal, reopening and view changes. A new general conversation SHALL default to Chat. Reopening SHALL retain an explicitly selected scope. Explicit New conversation SHALL reset only the global mobile session; an old asynchronous result SHALL NOT recreate a cleared session. Stored data errors SHALL degrade to a working in-memory session. Existing desktop and per-source sessions SHALL remain compatible.

#### Scenario: Collapse and reopen
- **GIVEN** two completed turns, a draft and Library selected
- **WHEN** the user dismisses and reopens the sheet
- **THEN** the same messages, draft and Library scope remain

#### Scenario: New default and explicit reset
- **WHEN** a general mobile session is first created or explicitly reset
- **THEN** it starts in Chat without a forced source question or microphone capture
- **AND** existing per-document/desktop and selection conversations remain intact

#### Scenario: Presentation remount
- **WHEN** a tablet changes to desktop presentation and later returns to mobile
- **THEN** the mobile session restores without duplicate hosts or microphone capture

#### Scenario: Late reply after reset
- **GIVEN** a turn is in flight
- **WHEN** the user starts a new conversation before it resolves
- **THEN** that reply cannot append to or reopen the new conversation

### Requirement: Shared conversational scope semantics
The global sheet SHALL support existing Chat, Document and Library semantics, multi-turn follow-ups, provider choice, privacy, token budgets, memory, tool handling and citation behavior. Chat SHALL allow general questions when source context is absent. Source-grounded scopes SHALL explain unavailable evidence instead of inventing citations or silently becoming Chat. Presentation changes SHALL NOT invoke an independent AI pipeline.

#### Scenario: Topic transition
- **GIVEN** a conversation began with a document question in Chat
- **WHEN** the next question concerns an unrelated topic
- **THEN** it can receive a general response without empty-source failure

#### Scenario: Grounded follow-up
- **GIVEN** cited answers in Document or Library scope
- **WHEN** the user asks a referential follow-up
- **THEN** conversation history resolves references while evidence and citations still obey the selected scope

### Requirement: Context belongs to the active view and submitted turn
The sheet SHALL show optional current-source context from the active mobile view, including selected passage, visible document section/page, current video timestamp and transcript status where available. Inactive views SHALL NOT contribute context. Each submitted turn SHALL freeze its source and history; changing views SHALL preserve conversation while changing the current-source indication. Source extraction SHALL happen through existing resolution paths when needed, never during invocation movement. Context removal SHALL prevent automatic reattachment for the same source revision until explicitly restored.

#### Scenario: Current PDF or EPUB
- **WHEN** the user opens Assistant over a reader and submits a context-aware question
- **THEN** the current selection/visible-section resolver supplies evidence and source position without navigating the reader

#### Scenario: Video context status
- **WHEN** the current video has partial or unavailable transcript context
- **THEN** the sheet displays that state honestly and preserves playback anchors without claiming full transcript coverage

#### Scenario: Change source in flight
- **GIVEN** a turn was submitted about source A
- **WHEN** source B becomes active before the response completes
- **THEN** the response remains attributed to A, the current-source indicator shows B, and A is not silently treated as B's evidence

#### Scenario: Background pane and cleared context
- **WHEN** an inactive pane publishes context or the user removes the active context chip
- **THEN** inactive context is ignored and the removed source does not immediately reattach on a playback or render update

#### Scenario: General application view
- **WHEN** the user invokes Assistant from library, dashboard or settings
- **THEN** Chat can proceed without a document attachment and hidden document/credential fields are not captured as context

### Requirement: Historical source privacy remains enforced
The system SHALL preserve source/privacy provenance for conversation turns and re-evaluate referenced current and historical sources before sending history or summaries to a provider. Excluded, unknown/deleted or local-only source material SHALL NOT leak through a later view/provider change. An unsafe request SHALL preserve visible history and explain recovery through a permitted local provider or new conversation. Microphone data and ephemeral context callbacks SHALL NOT enter conversation synchronization.

#### Scenario: Cloud switch after local-only source
- **GIVEN** prior conversation turns contain a local-only document
- **WHEN** a cloud provider is selected after leaving that document
- **THEN** the protected history is not transmitted and the user receives a clear recovery action

#### Scenario: Source now excluded or missing
- **WHEN** a historical source cannot be authorized under current policy
- **THEN** the request does not silently reuse its text or summary and visible history remains available locally

### Requirement: Selection Ask remains isolated
The global conversation SHALL coexist with the selection-based Ask composer and docked answer cards as separate session ownership. New selection Ask requests SHALL retain their passage/page context and existing scope/action semantics without resetting or polluting the global thread. Only one conflicting Assistant presentation SHALL be interactive at a time.

#### Scenario: Selection Ask between global turns
- **GIVEN** a global conversation exists
- **WHEN** the user closes it, asks about a selected passage, dismisses the answer card and reopens the global Assistant
- **THEN** the global messages and draft are unchanged and the selection answer belongs only to its selection session

#### Scenario: Selection action while global open
- **WHEN** an explicit selection Ask request is accepted while the global presentation is open
- **THEN** the global presentation closes while retaining its session, and the selection workflow opens without stacked competing sheets

### Requirement: Searchable command access alongside conversation
The global mobile Assistant SHALL expose a searchable Commands mode alongside Chat, using the existing shared command registry, matcher, availability gates and executor. Executing a command SHALL dismiss the sheet while preserving its Chat session. Opening the sheet SHALL NOT force the software keyboard. Existing keyboard palette invocation SHALL remain available.

#### Scenario: Find and execute an existing action
- **WHEN** the user selects Commands, searches for an available action and activates it
- **THEN** the shared command executor performs the same action as the keyboard palette and dismisses the sheet

#### Scenario: Return to conversation
- **WHEN** the user switches between Chat and Commands or reopens after a command
- **THEN** the global messages, draft and scope remain intact and no competing microphone capture continues
