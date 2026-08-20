## MODIFIED Requirements

### Requirement: Flashcard Studio groups work into sessions

The AI Flashcard Studio SHALL organize its workspace — chat messages, draft cards, context selection, and the selected document / deck / provider — into discrete **sessions**, where exactly one session is **active** at a time. Only the active session's messages, drafts, and context SHALL be loaded into the live Studio state and replayed into the LLM context window on send. A session SHALL persist independently of the others. Language Peek and sentence-mining drafts SHALL be stored in the active session with their bounded source/provenance metadata and SHALL not create a parallel language draft workspace.

#### Scenario: Active session is the only one loaded into the live workspace
- **WHEN** the user opens the Flashcard Studio and an active session exists
- **THEN** the chat, draft cards, context selection, and selected document / deck / provider shown are those of the active session only
- **AND** messages and drafts belonging to any other (non-active) session are not present in the live workspace

#### Scenario: Only the active session's history is sent to the model
- **WHEN** the user sends a new prompt in the Studio
- **THEN** the LLM context window is built from the active session's chat history only
- **AND** no messages, drafts, or context from any other (non-active) session are included

#### Scenario: Language mining draft uses the active session
- **WHEN** the learner sends a sentence-mining or Language Peek draft to Flashcard Studio
- **THEN** the draft SHALL be added to the active session with source anchor, media/provenance, analysis, and translation metadata
- **AND** no second language-specific Studio session or chat history SHALL be created

### Requirement: User can resume a past session with full state

The Studio SHALL allow the user to resume any past session from the Sessions view. Resuming SHALL load that session's chat messages, draft cards, context selection, and selected document / deck / provider back into the live Studio state, and SHALL make it the active session so that follow-up prompts use its chat history as the LLM context. Resumed language drafts SHALL retain their source identity and SHALL be marked stale when their source fingerprint no longer matches.

#### Scenario: Resuming a session restores its full workspace
- **WHEN** the user selects "Resume" on a past session in the Sessions view
- **THEN** that session becomes the active session
- **AND** its chat messages, draft cards, context selection, and selected document / deck / provider are loaded into the live Studio
- **AND** the view switches to the chat view so the user can continue

#### Scenario: Follow-up prompts use the resumed session's history
- **WHEN** the user resumes a session and then sends a new prompt
- **THEN** the LLM context window is built from the resumed session's chat history
- **AND** the response and any generated cards are recorded against the resumed (now active) session

#### Scenario: Resumed language draft is stale
- **WHEN** a resumed language draft's source or analysis fingerprint no longer matches the current source
- **THEN** the draft SHALL be labelled stale and SHALL require refresh or explicit learner confirmation before it is persisted as a learning item

