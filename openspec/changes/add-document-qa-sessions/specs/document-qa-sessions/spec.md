## ADDED Requirements

### Requirement: Document Q&A groups conversations into sessions

The Document Q&A tab SHALL organize its conversation — chat messages and the selected focus document — into discrete **sessions**, where exactly one session is **active** at a time. Only the active session's messages and focus document SHALL be loaded into the live chat state and replayed into the LLM context window on send. A session SHALL persist independently of the others.

#### Scenario: Active session is the only one loaded into the live chat

- **WHEN** the user opens the Document Q&A tab and an active session exists
- **THEN** the chat messages and the selected focus document shown are those of the active session only
- **AND** messages belonging to any other (non-active) session are not present in the live chat

#### Scenario: Only the active session's history is sent to the model

- **WHEN** the user sends a new prompt in the Document Q&A tab
- **THEN** the LLM context window is built from the active session's chat history only
- **AND** no messages from any other (non-active) session are included

### Requirement: User can start a new conversation that clears the live context window

The Document Q&A tab SHALL provide a "New chat" action that creates a new, empty session and makes it the active session. Activating it SHALL clear the live chat (messages) and reset the composer so that subsequent questions are not contaminated by the previously active conversation's turns. The previously active session SHALL be preserved as a resumable past session and SHALL NOT be deleted, and SHALL NOT lose any messages it already contained.

#### Scenario: Starting a new chat clears the context window

- **WHEN** the user triggers "New chat" while a conversation for Document A is active with chat turns
- **THEN** a new empty session becomes active
- **AND** the chat is empty and the composer is reset
- **AND** sending a question afterward does not reference Document A's prior turns

#### Scenario: The previous conversation is preserved after starting a new one

- **WHEN** the user starts a new chat as above
- **THEN** the previously active session (Document A's messages and focus document) remains available in the sessions list and can be resumed later
- **AND** no chat messages from that previous session are lost

#### Scenario: Guard against discarding a typed-but-unsent message

- **WHEN** the user triggers "New chat" while the composer contains non-empty, unsent text
- **THEN** the Document Q&A tab SHALL prompt the user before clearing
- **AND** the user may confirm to start the new chat or cancel to keep editing

### Requirement: Sessions are persisted and listed in a sidebar

The Document Q&A tab SHALL persist all sessions to local storage so they survive closing and reopening the tab or the application. The Document Q&A tab SHALL provide a chat-app-style, collapsible sidebar that lists past sessions with enough information to identify prior work: an auto-generated or user-set title, the last-updated timestamp, and the focus document (shown as "Whole Library" when no specific document is selected). The sidebar SHALL visually distinguish the active session from the others.

#### Scenario: Conversations survive a reopen

- **WHEN** the user creates one or more conversations, leaves the Document Q&A tab, and returns
- **THEN** all previously created sessions are still listed in the sidebar
- **AND** selecting one restores its contents (see the resume requirement)

#### Scenario: Sidebar shows identifying metadata

- **WHEN** the user opens the sidebar
- **THEN** each listed session displays its title, a relative last-updated time, and the focus document label
- **AND** the active session is visually distinguished from the others

#### Scenario: Sidebar is collapsible

- **WHEN** the user toggles the sidebar collapse control
- **THEN** the sidebar collapses or expands
- **AND** the collapsed/expanded choice persists across tab reopens

#### Scenario: Empty sidebar state

- **WHEN** the user opens the sidebar and no sessions exist
- **THEN** the Document Q&A tab SHALL show an empty-state message explaining that sending a message or starting a new chat will create one

### Requirement: User can resume a past conversation with full state

The Document Q&A tab SHALL allow the user to resume any past session from the sidebar. Resuming SHALL load that session's chat messages and selected focus document back into the live chat state, and SHALL make it the active session so that follow-up prompts use its chat history as the LLM context.

#### Scenario: Resuming a conversation restores its full state

- **WHEN** the user selects a past session in the sidebar
- **THEN** that session becomes the active session
- **AND** its chat messages and focus document are loaded into the live chat
- **AND** the view focuses the chat so the user can continue

#### Scenario: Follow-up prompts use the resumed conversation's history

- **WHEN** the user resumes a session and then sends a new prompt
- **THEN** the LLM context window is built from the resumed session's chat history
- **AND** the response is recorded against the resumed (now active) session

### Requirement: Sessions are auto-titled and user-renameable

The Document Q&A tab SHALL assign each new session an auto-derived title. The title SHALL be derived from the first user prompt in the session (truncated to a reasonable length), or — if no prompt exists yet — from the focus document's title (or "Whole Library" if none), or a placeholder if neither is available. The user SHALL be able to rename a session at any time from the sidebar, and the chosen title SHALL persist and be used in the sidebar. Subsequent auto-derivation SHALL NOT overwrite a user-set title.

#### Scenario: Auto-title from the first prompt

- **WHEN** a new session has no user-set title and the user sends its first prompt
- **THEN** the session's title is derived from that prompt text (truncated) and displayed in the sidebar

#### Scenario: Auto-title from the focus document

- **WHEN** a new session has no user-set title and no prompts, but a document is selected as the focus
- **THEN** the session's title is derived from the focus document's title, or shown as "Whole Library" when no document is selected

#### Scenario: User renames a conversation

- **WHEN** the user edits a session's title in the sidebar
- **THEN** the new title is saved to the session and displayed in place of the auto-derived title
- **AND** subsequent auto-derivation does not overwrite the user-set title

### Requirement: User can delete a session

The Document Q&A tab SHALL allow the user to delete a session from the sidebar. Deleting SHALL remove the session's messages and focus state from local storage. The Document Q&A tab SHALL confirm before deleting. Deleting a session SHALL NOT delete learning items (flashcards or extracts) that were already persisted to the learning-item database from that session's tool calls.

#### Scenario: Deleting a conversation with confirmation

- **WHEN** the user chooses to delete a session and confirms
- **THEN** the session is removed from the sidebar and from local storage
- **AND** it no longer appears in the sidebar

#### Scenario: Already-persisted learning items are unaffected by deletion

- **WHEN** the user deletes a session from which flashcards or extracts were previously saved to the learning-item database via tool calls
- **THEN** those saved learning items remain in the database and are unaffected by the session deletion
- **AND** only the session's in-tab conversation state (messages, focus document) is removed

#### Scenario: Deleting the active session

- **WHEN** the user deletes the session that is currently active and confirms
- **THEN** a new empty session is created and made active
- **AND** the chat is cleared and the tab remains usable

### Requirement: Legacy conversation state migrates into a default session

On first load after this capability is introduced, if no sessions exist in local storage but legacy Document Q&A conversation state is present (the pre-session persisted `messages` blob), the Document Q&A tab SHALL migrate that legacy state into a single default session and make it the active session. No user chat messages SHALL be lost during migration.

#### Scenario: Legacy state becomes a resumable default session

- **WHEN** the user opens the Document Q&A tab for the first time after upgrade and legacy conversation state exists in local storage but no sessions do
- **THEN** the tab creates a single session seeded with the legacy messages
- **AND** that session is active and its contents are visible in the live chat
- **AND** the user can resume it later like any other session

#### Scenario: Malformed legacy state does not crash the tab

- **WHEN** the legacy conversation state is present but cannot be parsed
- **THEN** the Document Q&A tab SHALL fall back to a fresh empty session rather than crashing
- **AND** no uncaught error is surfaced to the user
