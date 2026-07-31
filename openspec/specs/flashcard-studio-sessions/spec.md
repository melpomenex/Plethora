# flashcard-studio-sessions Specification

Defines how the AI Flashcard Studio organizes card-generation work into discrete, persistent **sessions** — each encapsulating its own chat history, draft cards, context selection, and selected document / deck / provider — so the user can start a clean context window for a new document or section without losing past work, and resume a previous session later.

## Purpose

The AI Flashcard Studio is the primary surface for generating flashcards from documents via an LLM. Without sessions it holds a single ever-growing conversation and draft pile, so moving from one document/section to another leaves the prior context contaminating generation (the model keeps referencing the old document) and mixes unrelated drafts. Sessions bound a unit of "the cards I'm creating from this document/section right now," with the ability to set work aside and pick it back up later. Sessions are a client-side (`localStorage`) workspace concept and do not affect the persisted spaced-repetition review session or the saved learning-item database.

## Requirements

### Requirement: Flashcard Studio groups work into sessions

The AI Flashcard Studio SHALL organize its workspace — chat messages, draft cards, context selection, and the selected document / deck / provider — into discrete **sessions**, where exactly one session is **active** at a time. Only the active session's messages, drafts, and context SHALL be loaded into the live Studio state and replayed into the LLM context window on send. A session SHALL persist independently of the others.

#### Scenario: Active session is the only one loaded into the live workspace

- **WHEN** the user opens the Flashcard Studio and an active session exists
- **THEN** the chat, draft cards, context selection, and selected document / deck / provider shown are those of the active session only
- **AND** messages and drafts belonging to any other (non-active) session are not present in the live workspace

#### Scenario: Only the active session's history is sent to the model

- **WHEN** the user sends a new prompt in the Studio
- **THEN** the LLM context window is built from the active session's chat history only
- **AND** no messages, drafts, or context from any other (non-active) session are included

### Requirement: User can start a new session that clears the live context window

The Studio SHALL provide a "New session" action that creates a new, empty session and makes it the active session. Activating it SHALL clear the live chat (messages), draft cards, and context focus (chapters / sections / pages / excerpt / search) so that subsequent generation is not contaminated by the previously active document's turns or drafts. The previously active session SHALL be preserved as a resumable past session and SHALL NOT be deleted.

#### Scenario: Starting a new session clears the context window

- **WHEN** the user triggers "New session" while a session for Document A is active with chat turns and draft cards
- **THEN** a new empty session becomes active
- **AND** the chat is empty, the draft cards list is empty, and the context selection is reset to its default
- **AND** generating cards afterward does not reference Document A's prior turns or drafts

#### Scenario: The previous session is preserved after starting a new one

- **WHEN** the user starts a new session as above
- **THEN** the previously active session (Document A's chat, drafts, and context) remains available in the sessions list and can be resumed later
- **AND** no chat messages or draft cards from that previous session are lost

#### Scenario: Confirm before abandoning unsaved drafts

- **WHEN** the user triggers "New session" while the active session contains draft cards that have never been persisted to the learning-item database
- **THEN** the Studio SHALL prompt the user with a choice before clearing
- **AND** the user may either keep those drafts (copied into the new session) or start with a clean draft list

### Requirement: Sessions are persisted and listed

The Studio SHALL persist all sessions to local storage so they survive closing and reopening the modal or the application. The Studio SHALL provide a Sessions view that lists past sessions with enough information to identify prior work: an auto-generated or user-set title, the last-updated timestamp, the count of cards produced, and the source document name when one was selected.

#### Scenario: Sessions survive a reopen

- **WHEN** the user creates one or more sessions, closes the Flashcard Studio, and reopens it
- **THEN** all previously created sessions are still listed in the Sessions view
- **AND** selecting one restores its contents (see the resume requirement)

#### Scenario: Sessions list shows identifying metadata

- **WHEN** the user opens the Sessions view
- **THEN** each listed session displays its title, a relative last-updated time, the number of cards it produced, and the source document name (if any)
- **AND** the active session is visually distinguished from the others

#### Scenario: Empty sessions view

- **WHEN** the user opens the Sessions view and no sessions exist
- **THEN** the Studio SHALL show an empty-state message explaining that starting a new session or generating cards will create one

### Requirement: User can resume a past session with full state

The Studio SHALL allow the user to resume any past session from the Sessions view. Resuming SHALL load that session's chat messages, draft cards, context selection, and selected document / deck / provider back into the live Studio state, and SHALL make it the active session so that follow-up prompts use its chat history as the LLM context.

#### Scenario: Resuming a session restores its full workspace

- **WHEN** the user selects "Resume" on a past session in the Sessions view
- **THEN** that session becomes the active session
- **AND** its chat messages, draft cards, context selection, and selected document / deck / provider are loaded into the live Studio
- **AND** the view switches to the chat view so the user can continue

#### Scenario: Follow-up prompts use the resumed session's history

- **WHEN** the user resumes a session and then sends a new prompt
- **THEN** the LLM context window is built from the resumed session's chat history
- **AND** the response and any generated cards are recorded against the resumed (now active) session

### Requirement: Sessions are auto-titled and user-renameable

The Studio SHALL assign each new session an auto-derived title. The title SHALL be derived from the first user prompt in the session (truncated to a reasonable length), or — if no prompt exists yet — from the selected document's title, or a placeholder if neither is available. The user SHALL be able to rename a session at any time, and the chosen title SHALL persist and be used in the Sessions view.

#### Scenario: Auto-title from the first prompt

- **WHEN** a new session has no user-set title and the user sends its first prompt
- **THEN** the session's title is derived from that prompt text (truncated) and displayed in the Sessions view

#### Scenario: Auto-title from the selected document

- **WHEN** a new session has no user-set title and no prompts, but a document is selected
- **THEN** the session's title is derived from the selected document's title

#### Scenario: User renames a session

- **WHEN** the user edits a session's title
- **THEN** the new title is saved to the session and displayed in the Sessions view in place of the auto-derived title
- **AND** subsequent auto-derivation does not overwrite the user-set title

### Requirement: User can delete a session

The Studio SHALL allow the user to delete a session from the Sessions view. Deleting SHALL remove the session's chat, drafts, and context from local storage. The Studio SHALL confirm before deleting. Deleting a session SHALL NOT delete learning items that were already persisted to the learning-item database from that session.

#### Scenario: Deleting a session with confirmation

- **WHEN** the user chooses to delete a session and confirms
- **THEN** the session is removed from the sessions list and from local storage
- **AND** it no longer appears in the Sessions view

#### Scenario: Already-persisted learning items are unaffected by deletion

- **WHEN** the user deletes a session from which some draft cards were previously saved to the learning-item database
- **THEN** those saved learning items remain in the database and are unaffected by the session deletion
- **AND** only the session's in-Studio workspace state (chat, unsaved drafts, context) is removed

### Requirement: Legacy workspace state migrates into a default session

On first load after this capability is introduced, if no sessions exist in local storage but legacy Flashcard Studio workspace state is present (the pre-session single-blob persisted chat, drafts, and selections), the Studio SHALL migrate that legacy state into a single default session and make it the active session. No user data (chat messages or draft cards) SHALL be lost during migration.

#### Scenario: Legacy state becomes a resumable default session

- **WHEN** the user opens the Flashcard Studio for the first time after upgrade and legacy workspace state exists in local storage but no sessions do
- **THEN** the Studio creates a single session seeded with the legacy chat, drafts, and selections
- **AND** that session is active and its contents are visible in the live workspace
- **AND** the user can resume it later like any other session

#### Scenario: Malformed legacy state does not crash the Studio

- **WHEN** the legacy workspace state is present but cannot be parsed
- **THEN** the Studio SHALL fall back to a fresh empty session rather than crashing
- **AND** no uncaught error is surfaced to the user
