## ADDED Requirements

### Requirement: Progressive replies across chat interfaces

Every in-app LLM chat interface SHALL show one in-progress reply in the originating conversation. When a provider delivers readable reply text incrementally, the surface SHALL display it in order before the model completes. The surface SHALL finalize the same reply in place with its normal formatting, validated citations, and available message actions. The user SHALL be able to read earlier messages without streaming changing their reading position or moving keyboard focus.

#### Scenario: A reply becomes readable before completion

- **WHEN** a user sends a message and the provider delivers readable answer text while the request is still open
- **THEN** that text becomes visible in the reply before the provider completes
- **AND** later fragments extend the same reply in order
- **AND** the conversation displays and records the completed reply once

#### Scenario: The user is reading an earlier message

- **WHEN** new text arrives while the user has scrolled away from the latest reply
- **THEN** the reply still updates and the user's scroll position and focus are preserved

### Requirement: Chat previews expose only user-facing reply text

The chat reply preview SHALL contain only readable answer text. The app SHALL keep tool calls, arguments, internal serialization, model or tool metadata, hidden reasoning, and preparatory model output out of the reply preview throughout generation and at completion. If a chat protocol carries answer text inside an envelope, only the portion identified as answer text and safe to display SHALL enter the preview. An existing separate thinking disclosure SHALL continue to follow the thinking-display requirements.

#### Scenario: Prose and tool activity are interleaved

- **WHEN** a provider sends answer fragments around a tool call, including when tool markers and arguments are split across chunks
- **THEN** the UI displays only the readable answer fragments in order
- **AND** no part of the tool call, its arguments, or its protocol markers flashes in the reply
- **AND** any user-facing tool status or result uses the chat's existing presentation and approval rules

#### Scenario: The answer is inside a structured chat reply

- **WHEN** a chat reply is encoded in a structured envelope
- **THEN** only safely identified answer text can appear incrementally
- **AND** when the answer field cannot yet be identified safely, the chat keeps showing its current stage until readable text or a validated completed reply is available
- **AND** the final message is eligible for history and message actions only after existing validation succeeds

### Requirement: Visible chat status before and between reply fragments

From submission until a terminal outcome, chat SHALL show a meaningful textual status while waiting for readable output. The status SHALL reflect the current stage, such as gathering sources, waiting for the model, waiting for a tool, or retrying. Stage changes SHALL be available to assistive technology without repeated announcements of individual chunks. A stalled request SHALL surface an actionable timeout or error under the applicable deadline.

#### Scenario: The model has yet to send readable text

- **WHEN** a user sends a message that requires source retrieval before generation
- **THEN** the conversation immediately shows that it is preparing the reply or gathering sources
- **AND** the status changes to waiting for the model once generation starts
- **AND** the first readable text appears in the reply as soon as it is available

#### Scenario: Only a completed answer is available

- **WHEN** the chosen chat operation supplies only a completed answer
- **THEN** the app shows what it is waiting for and displays the answer once it arrives
- **AND** the app preserves the chosen provider and does not replay the answer as simulated streaming

### Requirement: Stream ownership and terminal state in chat

Chat status and output SHALL belong to the originating conversation and active reply attempt. Stopping the reply SHALL stop visible updates and propagate cancellation to the underlying operation where supported. The chat SHALL finalize an attempt once as completed, failed, or cancelled. Any retained partial reply SHALL be labeled interrupted and kept out of completed-message actions and future model context. A retry SHALL start with an empty preview under the request's existing routing and consent rules.

#### Scenario: Replies overlap across conversations

- **WHEN** two chats have active replies and receive interleaved updates
- **THEN** each chat renders only the text, status, and outcome for its current attempt
- **AND** cancelling or completing one reply does not end the other

#### Scenario: A stopped or failed reply is retried

- **WHEN** an attempt is stopped or fails after displaying partial text and the user retries
- **THEN** the retry begins with a fresh preview
- **AND** late events from the previous attempt cannot append to the new reply, complete it, or update chat history

#### Scenario: Two chat subscribers share a coalesced request

- **WHEN** two valid chat subscribers share one coalesced request
- **THEN** each active subscriber receives progress from that single invocation
- **AND** when one subscriber stops waiting, its updates cease and the remaining subscriber continues receiving the reply
