## Purpose

Let readers keep one durable, source-aware conversation across Assistant presentations, navigation, failures, upgrades and supported devices without losing drafts or executing saved actions again.

## ADDED Requirements

### Requirement: Conversation identity is independent of presentation and source

The Assistant SHALL maintain a stable conversation ID, title, creation/update timestamps, ordered messages/turns, draft, active and historical source references, per-turn evidence, citations, provider provenance, tool/artifact results and recoverable request states. Supported sidebar, workspace, mobile and PWA presentations SHALL open that same conversation by ID. Switching presentations or documents SHALL NOT clear or silently replace its history. Account/local-profile boundaries SHALL isolate records.

#### Scenario: Sidebar expands into research workspace
- **GIVEN** a reader conversation has answers, citations and an unsent section-referenced draft
- **WHEN** the user expands it into the workspace and returns to the sidebar
- **THEN** the same conversation ID, messages, submitted source context, citations and draft are shown
- **AND** no request or saved tool effect is replayed

#### Scenario: Mobile navigation and reopen
- **GIVEN** a mobile conversation contains several turns and a draft
- **WHEN** the user closes the sheet, changes views and reopens History
- **THEN** the conversation and draft remain available with each turn's original sources
- **AND** newly inferred active context is visibly distinguished from historical context

#### Scenario: Account changes
- **GIVEN** a conversation is active under one account or local profile
- **WHEN** the user switches account
- **THEN** the previous projection and active request are detached or cancelled and cannot appear in the new account
- **AND** the original records remain in their original authorized partition

### Requirement: Durable save failures preserve user work

The system SHALL acknowledge local persistence independently of model completion and sync. Text, mention tokens, selections and attachment references SHALL survive normal dismissal, reload and session changes after a save acknowledgment. If persistence fails, the live work SHALL remain editable with retry/export recovery and navigation that would discard it SHALL be deferred. Received remote drafts SHALL NOT overwrite dirty local input.

#### Scenario: Storage is full
- **GIVEN** the user has an unsaved passage-referenced draft
- **WHEN** a save fails and the user requests another conversation
- **THEN** a recoverable save error is visible and the original draft remains available
- **AND** the requested transition does not silently discard the draft

#### Scenario: Draft restored after reload
- **GIVEN** draft text, raw mentions, a selection and attachment assets were acknowledged as saved
- **WHEN** the application reloads
- **THEN** those values restore without submission, guessed source IDs or tool execution

### Requirement: Every request belongs to a frozen originating turn

Submitting SHALL freeze conversation/turn/attempt identity, question, source policy, source identities/versions/locators, history provenance and effective provider plan. Async progress, replies and tool effects SHALL apply only to that originating attempt. Switching view/source SHALL NOT redirect a reply. A completed response SHALL be persisted to its original thread even if another presentation is active. Interrupted processes SHALL recover an honest interrupted state without automatic model or tool replay.

#### Scenario: Source changes during generation
- **GIVEN** a question was submitted about PDF A
- **WHEN** the user opens PDF B before the answer finishes
- **THEN** the answer remains associated with A and the original conversation/turn
- **AND** B's composer/context cannot acquire A's reply as a new turn or receive A's viewer actions

#### Scenario: Process dies while answering
- **GIVEN** an attempt was durably started but not finalized
- **WHEN** the app restarts
- **THEN** the attempt is shown as interrupted with preserved question and known partial output
- **AND** generation or an uncertain side effect resumes only through explicit recovery

### Requirement: Cancellation and retry preserve turn identity and effects

Stop SHALL abort underlying work where supported and otherwise detach it with an accurate explanation. Detached or superseded output SHALL NOT overwrite accepted output or trigger actions. Retry SHALL reuse the original user turn with a new attempt identity, revalidate its frozen plan and avoid duplicate user messages or previously completed side effects. Changed or revoked sources SHALL require visible recovery before a new dispatch.

#### Scenario: Cancel and retry
- **GIVEN** one turn is generating and its transport supports cancellation
- **WHEN** the user stops it and retries
- **THEN** the first attempt is cancelled and a new attempt belongs to the same user turn
- **AND** late first-attempt output is ignored and successful tool results are not repeated

#### Scenario: Provider cannot cancel
- **GIVEN** the provider cannot abort an already-dispatched request
- **WHEN** the user selects Stop
- **THEN** the UI stops accepting its output and explains that provider work may continue
- **AND** no unsupported guarantee of transport cancellation is displayed

### Requirement: Progress and streaming describe actual execution

The Assistant SHALL show accessible lifecycle states only from real resolution, retrieval, preparation, generation and validation events. Streaming SHALL be enabled only for a supported configured request path. Provisional content SHALL remain distinct from validated evidence; citations and tool effects SHALL not become actionable before their final validation. Non-streaming providers SHALL retain useful real status and stop/retry behavior without fake typing or percentages.

#### Scenario: Supported text stream
- **GIVEN** the resolved provider supports the context-bearing streamed request
- **WHEN** text deltas arrive
- **THEN** sanitized provisional text appears while the composer stays responsive
- **AND** final evidence/actions appear only after validation

#### Scenario: Non-streaming structured response
- **GIVEN** a grounded answer requires a non-streaming structured result
- **WHEN** the request runs
- **THEN** actual phase status is shown and no citation links are presented from incomplete JSON
- **AND** the validated final answer or a recoverable validation failure is persisted

### Requirement: Migration preserves all recoverable legacy data

Migration SHALL preserve every recoverable legacy conversation, message, draft, attachment, source reference and saved response without applying legacy retention caps. It SHALL be idempotent, resumable, durably verified and retain untouched rollback originals. Unknown/malformed data SHALL be recoverable with a stated import limitation rather than silently discarded. Existing discarded data SHALL NOT be falsely claimed as recovered. Hydration SHALL never replay saved effects.

#### Scenario: More records than legacy UI caps
- **GIVEN** raw legacy storage contains more than 50 Q&A sessions, 50 messages per session or 200 sidebar messages
- **WHEN** migration runs twice with a crash between checkpoints
- **THEN** every recoverable raw record is imported exactly once with drafts/assets and provenance intact
- **AND** import manifests/read-back verify content and the original raw values remain unchanged

#### Scenario: Corrupt record and rollback
- **GIVEN** one legacy record is malformed and valid records coexist with it
- **WHEN** migration or subsequent feature rollback occurs
- **THEN** valid imported conversations remain readable, malformed bytes remain recoverable, and an import limitation is shown
- **AND** rollback does not overwrite canonical data with capped legacy projections

### Requirement: Responsiveness is bounded and measurable

Opening or typing SHALL NOT trigger full-document extraction, indexing or whole-library processing. Context preparation and citation resolution SHALL use bounded/versioned work, and long histories SHALL not prevent responsive input. Release validation SHALL record invocation, context, retrieval, provider, validation, persistence and navigation timings against declared fixture/device baselines and pass repository benchmark/bundle gates. Proposed budgets SHALL NOT be reported as measured results.

#### Scenario: Large library and PDF
- **GIVEN** a library of at least 3,000 items, a 1,000-page PDF and a 1,000-message saved conversation
- **WHEN** the user opens Assistant, types and expands source details
- **THEN** opening/typing uses metadata and bounded visible history without eagerly extracting the whole PDF or scanning every citation
- **AND** measured interaction timings satisfy the declared validation budgets on recorded hardware

### Requirement: Learning actions require explicit authority and persist outcomes

The Assistant SHALL preserve existing flashcard, cloze and extract actions with source ownership, tool permissions and confirmation safeguards. Only explicit user action/creation intent SHALL authorize the allowed application action set; arbitrary model or source text SHALL not grant privileges. Saved results SHALL reference actual created artifacts and SHALL not execute again on hydration, retry or synchronization. Only user-promoted artifacts SHALL enter the normal durable knowledge index.

#### Scenario: Create a learning artifact from an answer
- **GIVEN** an authorized answer with source references
- **WHEN** the user chooses Make flashcard or requests an extract and completes applicable confirmation
- **THEN** the existing creation flow saves a real artifact with provenance and a navigable result link
- **AND** reopening or synchronizing the thread does not recreate it

#### Scenario: Model or source text requests a privileged action
- **GIVEN** an ordinary explanatory question with no authorized creation action
- **WHEN** the source or model response emits tool syntax or action instructions
- **THEN** those bytes cannot grant execution authority or bypass permission/confirmation
- **AND** the ordinary answer remains usable without an unsolicited application side effect
