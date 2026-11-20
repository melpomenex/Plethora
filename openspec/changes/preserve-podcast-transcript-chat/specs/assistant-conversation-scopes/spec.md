## ADDED Requirements

### Requirement: Podcast transcript conversations resume by episode

The Assistant SHALL use the same local conversation for all **Chat About This** entry points for a podcast episode. Closing the panel or navigating away SHALL preserve the saved message thread, unsent text, and selected answer scope. Reopening the episode's chat, including after an app reload in the same profile, SHALL restore that state. The Assistant SHALL use that episode's transcript and conversation history when preparing follow-up requests under the selected scope.

#### Scenario: Reopen from a different entry point

- **GIVEN** the user asks a question from the episode list, receives a reply, chooses a different answer scope, and types an unsent follow-up
- **WHEN** they close the panel and reopen the same episode's chat from the player or transcript viewer
- **THEN** the prior messages, unsent text, and selected scope are restored in that episode's panel
- **AND** the follow-up remains unsent until the user submits it

#### Scenario: Resume after navigation or reload

- **GIVEN** the episode's chat has saved messages or an unsent draft
- **WHEN** the user leaves Podcasts or reloads the app and later opens that episode's chat
- **THEN** the saved state is restored in the same profile

### Requirement: Podcast episode conversations are isolated

The Assistant SHALL isolate history and drafts by stable podcast episode identity across feeds, titles, and changes to transcript text. A new episode conversation SHALL start with the standard empty-chat state. Previously stored shared history without verifiable episode ownership SHALL remain unassigned and SHALL NOT appear in an episode chat or its request history.

#### Scenario: Switch between two episodes with the same title

- **GIVEN** two episodes have the same title and different transcripts, and episode A has a conversation and a draft
- **WHEN** the user opens episode B's chat for the first time and sends a question
- **THEN** B starts with an empty chat, and the request uses B's transcript without A's messages or draft
- **AND** reopening A restores its own conversation and draft

#### Scenario: The episode title or transcript changes

- **GIVEN** an episode has a saved conversation and later receives an updated title or transcript under the same episode identity
- **WHEN** the user reopens the episode chat and asks a follow-up
- **THEN** the prior turns are still present and the follow-up uses the episode's current transcript

#### Scenario: Legacy shared history is present

- **GIVEN** an older version saved chat state under a shared key without an episode association
- **WHEN** the user opens an episode chat for the first time after upgrading
- **THEN** the chat starts empty and the legacy record remains intact

### Requirement: Submitted podcast chat turns survive passive dismissal

An ordinary podcast chat turn SHALL remain attached to its originating episode and attempt when the user closes the panel or changes views while the app is running. On reopen, the Assistant SHALL show the active request or its saved outcome. Late outcomes SHALL update only that turn and SHALL NOT resurrect state after an explicit Stop or Clear Chat. If an app restart interrupts a pending turn, the Assistant SHALL preserve its question and expose explicit recovery without automatically sending another request. Restoring a conversation SHALL NOT replay completed tool actions.

#### Scenario: Reply finishes after the panel closes

- **GIVEN** the user closes the episode chat while a reply is pending
- **WHEN** the provider finishes before the user reopens the chat
- **THEN** the thread shows the original question and the completed answer exactly once

#### Scenario: Reply finishes while another episode is open

- **GIVEN** a question about episode A has been submitted and its reply is pending
- **WHEN** the user opens episode B before the reply arrives
- **THEN** B remains independent and receives no messages or progress from A
- **AND** reopening A shows the pending turn or its answer or failure, with one copy of the submitted question

#### Scenario: Stop or clear the episode chat

- **GIVEN** episode A has a pending turn and episode B has saved messages
- **WHEN** the user explicitly stops A's turn or clears A's chat and the request later completes
- **THEN** a stopped turn stays stopped and a cleared thread stays cleared after reopening
- **AND** B retains its saved conversation

#### Scenario: The app ends before a reply finishes

- **GIVEN** the Assistant has saved a submitted question and its reply has yet to finish
- **WHEN** the app restarts and the user opens that episode's chat
- **THEN** the question appears with an interrupted state and the user can choose to retry
- **AND** opening the chat sends no model request and runs no tool
