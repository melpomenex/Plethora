# document-qa-workspace Specification

## Purpose
Help readers move directly from the command hub to a saved Document Q&A conversation, ask natural questions with an explicit source scope, and inspect the evidence behind each answer without losing existing work.

## Requirements

### Requirement: Ask about your library opens Document Q&A

Activating “Ask about your library” in the command hub SHALL close the palette and open or activate the existing Document Q&A workspace. It SHALL reuse an existing workspace tab even when that tab is in another pane. The bare action SHALL prepare a blank library-scoped composer with web search off, without inserting a question, submitting a turn, opening the reader's selection-actions sheet, or starting AI/retrieval work. Repeated activation without intervening editing or submission SHALL reuse the same prepared conversation.

#### Scenario: Bare quick action
- **WHEN** the user activates Ask about your library by pointer, touch, or keyboard
- **THEN** Document Q&A is visible with an empty composer and the applicable library scope shown
- **AND** the palette closes and no question or generation request is submitted

#### Scenario: Workspace already exists in another pane
- **WHEN** Document Q&A is already open in another pane and the user activates the quick action twice without editing
- **THEN** the existing tab and its prepared conversation are activated
- **AND** duplicate tabs or empty conversations are not created

### Requirement: Library-question suggestions preserve their complete intent

Library-question suggestions in the command hub SHALL open Document Q&A and prefill the complete editable question and applicable document/passage context exactly once. The displayed source scope SHALL match that context. Only an explicit Ask SHALL submit the question. Related-document search, review suggestions, product-help retrieval, and the reader's selection Ask SHALL retain their established destinations and behavior.

#### Scenario: Prefill a document summary
- **WHEN** the user selects a summary suggestion for an eligible document
- **THEN** Document Q&A contains the full question and visibly targets that document
- **AND** no request is submitted until the user activates Ask

#### Scenario: Mounting is delayed
- **WHEN** the destination mounts or hydrates after the palette has closed, including a repeated development mount
- **THEN** the pending intent is applied once after the intended workspace is ready
- **AND** no newer intent is cleared by completion of an older one

#### Scenario: Unrelated entry paths
- **WHEN** the user selects related-document search, today's review, product help, or Ask from a reader selection
- **THEN** the established workflow for that entry path remains available
- **AND** it is not redirected by the library-workspace handoff

### Requirement: Entry and history changes preserve ongoing work

Opening a new library question or prefilling a question SHALL preserve the previous conversation and any unsent draft before changing sessions. Draft preservation SHALL retain text and its document/section references through session changes and reload. Legacy sessions without draft metadata SHALL remain readable. A response already in flight SHALL be saved to its originating conversation before a queued entry changes sessions; incompatible session/scope changes SHALL be deferred or disabled with an explanation. Pending entry SHALL be dismissible. Saved tool effects SHALL NOT execute again on restore.

#### Scenario: Existing focused conversation has a draft
- **WHEN** a document-focused conversation contains sent messages and an unsent section-referenced draft and the user chooses Ask about your library
- **THEN** a clean library composer opens and the previous conversation is preserved
- **WHEN** the user returns to that conversation, including after reload
- **THEN** its messages, scope, and draft references are restored without submission

#### Scenario: Entry arrives during generation
- **WHEN** the user opens a library question while an answer is being generated in another Q&A conversation
- **THEN** the workspace opens and communicates that the new entry is pending
- **AND** the answer is saved only to its originating conversation before the new entry is prepared

#### Scenario: Old or malformed draft record
- **WHEN** a saved session has no draft record or an unusable draft record
- **THEN** valid saved history and citations still load with an empty draft
- **AND** the workspace remains usable without replaying tool effects

#### Scenario: Outgoing draft cannot be saved
- **WHEN** session storage fails while preparing to leave a conversation with an unsent draft
- **THEN** the live draft remains available and a recoverable save error is shown
- **AND** the session change does not silently discard that draft

### Requirement: Source scope is explicit and enforced

The workspace SHALL expose source scope adjacent to the composer, with an applicable whole-library choice and searchable document selection that does not require mention syntax. It SHALL identify a collection restriction when one applies. Explicit document mentions and section references SHALL visibly narrow or override that base scope according to the established targeting rules. Removing an override SHALL reveal the base scope. The submitted request SHALL use only eligible sources in the displayed scope and obey existing local-only and AI-excluded rules. A missing/ineligible selected source or an empty eligible set SHALL NOT silently broaden the request.

#### Scenario: Choose one document without syntax
- **WHEN** the user searches for and selects a document in the source control and asks an ordinary knowledge question
- **THEN** the selected title is visible beside the composer
- **AND** evidence retrieval is restricted to that eligible document

#### Scenario: Advanced scope override
- **WHEN** the user adds a document mention or section reference that changes the effective source scope
- **THEN** the effective source is visibly identified before submission
- **WHEN** the user removes that override
- **THEN** the underlying source selection applies again

#### Scenario: Restricted collection or excluded document
- **WHEN** the active collection limits the available sources or contains AI-excluded documents
- **THEN** the scope label communicates the collection restriction
- **AND** the submitted source set excludes ineligible and out-of-collection documents

#### Scenario: Selected document becomes unavailable
- **WHEN** the chosen document is deleted or becomes ineligible before Ask is activated
- **THEN** the question is retained and the user is asked to choose an available source
- **AND** no broader library request is silently substituted

### Requirement: The initial workspace leads with a single question composer

An empty conversation SHALL show a prominent natural-language question field, concise guidance, source scope, and a labeled Ask action within the initial viewport. Asking SHALL NOT require knowledge of mentions, slash commands, indexing terminology, or keyboard shortcuts. The same draft SHALL continue into the conversation composer after submission. Advanced document/section controls, web search, and flashcard commands SHALL remain discoverable as secondary controls. Web-search state SHALL be explicit when enabled.

#### Scenario: First question without mentions
- **WHEN** a user opens a new workspace with eligible library sources
- **THEN** they can type and submit a natural question without entering mention syntax
- **AND** the source control and Ask action are visible alongside the question field

#### Scenario: Conversation begins
- **WHEN** the user explicitly submits the first question
- **THEN** the workspace shows the question in the transcript with its submitted scope
- **AND** the composer remains available for continued use without duplicate input fields

### Requirement: Starter actions prepare editable questions

The empty workspace SHALL offer Find connections, Compare viewpoints, and Summarize a document as optional starter actions. Connections and viewpoints SHALL prepare locally defined, editable questions; document summary SHALL obtain a real document selection before preparing its question. Starter activation SHALL focus the prepared question without submitting it or calling a model. It SHALL NOT overwrite an existing nonempty draft. Starter wording SHALL describe matching source evidence without promising exhaustive corpus analysis.

#### Scenario: Compare viewpoints starter
- **WHEN** the user selects Compare viewpoints with an empty draft
- **THEN** an editable question asking for agreement/disagreement with supporting evidence appears in the composer
- **AND** no AI request starts until Ask is activated

#### Scenario: Summarize a real document
- **WHEN** the user selects Summarize a document without a document scope
- **THEN** the source picker opens
- **WHEN** an eligible document is selected
- **THEN** a summary question is prepared with that document's scope

#### Scenario: Draft already exists
- **WHEN** the user has already entered a question and activates a starter
- **THEN** the existing draft is retained
- **AND** replacement requires an explicit user action

### Requirement: Ordinary knowledge answers remain grounded in the selected sources

In `Document` and `Library` scopes, ordinary library/document knowledge questions SHALL use the grounded retrieval workflow for the displayed eligible scope while maintaining multi-turn conversation history so follow-up questions resolve references to prior turns and cited sources. In `Chat` scope, the workspace SHALL use the selected source(s) as contextual grounding while permitting broader model knowledge and multi-turn exploration. Answer claims with citations SHALL refer to actual supplied evidence. Existing section/chapter requests, learning-item tool workflows (using the unified 4-stage tool-call parser), and explicit web-search questions SHALL retain their specialized behavior, include relevant conversation history, and accurately show their source context. Weak, conflicting, absent, or unavailable evidence SHALL be described honestly in `Document` and `Library` scopes; failure SHALL NOT silently produce an answer from unsupported general knowledge. Existing provider/privacy (`isAiExcluded`, `isLocalOnly`, and cloud AI disclosure) and retrieval-only behavior SHALL remain enforced.

#### Scenario: Selected-document knowledge answer
- **WHEN** the user asks an ordinary knowledge question with one document selected in `Document` or `Library` scope and follows up referring to the previous answer
- **THEN** the answer uses retrieved evidence restricted to that document while resolving follow-up references across turns
- **AND** any displayed citations refer to actual supporting passages

#### Scenario: Matching evidence is insufficient
- **WHEN** retrieval returns weak or no supporting evidence in `Document` or `Library` scope
- **THEN** the result explains the limitation, allows question/source refinement, and offers to continue in `Chat` scope
- **AND** it does not claim an exhaustive search or invent support

#### Scenario: Expert section or tool workflow
- **WHEN** the user explicitly targets a chapter/section or requests the existing flashcard formulation workflow across multiple turns or in `Library` scope
- **THEN** its established focused context, real source retrieval, 4-stage tool parsing, card creation, and saved-result behavior continue to work
- **AND** the workspace does not invent citation metadata for a response that has none

#### Scenario: YouTube document in Document Q&A uses canonical transcript
- **WHEN** the user selects a YouTube video document in Document Q&A whose transcript was fetched via on-device InnerTube or the video viewer
- **THEN** Document Q&A resolves the persisted canonical transcript and timestamps for retrieval and section/context answering

### Requirement: Evidence stays associated with its answer

Answers with structured citations SHALL expose readable source titles, supporting excerpts, and available locations through an expandable source region. A compact evidence summary SHALL show the submitted scope and actual distinct cited-document count when those facts are available. Citation numbering, answer/source association, and copy-with-sources behavior SHALL remain consistent after reload or source changes. Activating a resolvable citation SHALL open its cited passage through the existing reader navigation; unavailable locations SHALL have an honest fallback. Legacy answers SHALL NOT gain fabricated evidence metadata or duplicated source lists.

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

### Requirement: Setup, progress, and failures support recovery

On supported platforms the quick action SHALL remain navigable when the library is empty or generation is unconfigured. The workspace SHALL provide applicable import/setup actions and retain a usable draft. Processing SHALL expose an accessible status, using specific phases or coverage counts only when backed by actual events/data. Failures SHALL distinguish unavailable sources, setup/provider errors, and retrieval errors with useful recovery. Retry SHALL restore the original question and scope for explicit submission and SHALL NOT duplicate submitted turns or already-completed tool effects.

#### Scenario: Empty library
- **WHEN** the user opens Document Q&A without documents
- **THEN** the workspace explains that sources must be imported and offers Import documents
- **AND** a typed draft remains available for return after importing

#### Scenario: Missing generation setup
- **WHEN** the selected answering mode needs configuration
- **THEN** the workspace offers the relevant Settings action with an explanation
- **AND** the question is preserved when the user returns

#### Scenario: Retrieval fails and the user retries
- **WHEN** retrieval fails after explicit submission and the user selects Retry
- **THEN** the original question and scope are restored for review and explicit Ask
- **AND** the retry does not duplicate the prior user turn or replay completed side effects

### Requirement: History and destructive actions remain discoverable

Saved conversations SHALL remain reachable on both wide and narrow layouts. New conversation SHALL be the primary history action and SHALL preserve outgoing messages/drafts. Clearing and deleting SHALL be secondary actions with the existing confirmation safeguards. History, rename, and delete controls SHALL be usable without hover. Narrow screens SHALL offer history in an accessible drawer/sheet and retain access to source details.

#### Scenario: Resume history on a phone
- **WHEN** the user opens History on a narrow viewport and selects a saved conversation
- **THEN** that conversation's messages, scope, and draft load
- **AND** the history surface dismisses with focus returned to the workspace

#### Scenario: Clear is a deliberate secondary action
- **WHEN** a user opens the conversation overflow and chooses Clear conversation
- **THEN** a confirmation appears before saved conversation content is removed
- **AND** ordinary entry or New conversation does not clear saved history

### Requirement: Workspace supports keyboard, touch, themes, and narrow layouts

Desktop handoff SHALL focus the labeled question field after navigation settles. Touch entry SHALL not force open the software keyboard until the user chooses the field or a starter. Enter SHALL submit only outside IME composition; Shift+Enter SHALL insert a newline. Escape SHALL close the innermost picker/drawer and return focus to its trigger. Controls SHALL have accessible names, visible focus, and effective targets of at least 40 CSS pixels. The workspace SHALL use the active app theme, respect reduced motion, remain usable at 200% zoom, and avoid horizontal page scrolling at 360 CSS pixels with long titles/translations. The composer and Ask action SHALL remain reachable above the software keyboard and safe area.

#### Scenario: Keyboard entry and IME
- **WHEN** the desktop user enters from the palette, edits a question, and confirms IME composition
- **THEN** the input receives focus and the composition confirmation does not submit
- **WHEN** the user presses Enter outside composition
- **THEN** the question is submitted once

#### Scenario: Narrow layout and touch entry
- **WHEN** the workspace opens at 360 CSS pixels with a long selected title
- **THEN** the source selection, question, Ask action, and History control remain reachable without horizontal page scrolling
- **AND** the keyboard opens only after an intentional input/starter interaction

#### Scenario: Theme and motion preferences
- **WHEN** the user switches between a light theme and a dark/gold theme with reduced motion enabled
- **THEN** text, controls, sources, and focus indicators remain readable in that theme
- **AND** state transitions do not depend on decorative animation

### Requirement: Opening and source browsing remain bounded

Opening the workspace, preparing a starter, or browsing source choices SHALL use available metadata without eager whole-library extraction, embedding generation, or AI/network work. Source search SHALL remain usable with at least 3,000 documents using bounded displayed results. The implementation SHALL pass the repository's local benchmark and bundle-budget gates.

#### Scenario: Large library entry
- **WHEN** the user opens Document Q&A with 3,000 documents and searches the source picker
- **THEN** the composer and source search remain usable without a full content load
- **AND** no model, indexing, or retrieval request starts before explicit Ask
