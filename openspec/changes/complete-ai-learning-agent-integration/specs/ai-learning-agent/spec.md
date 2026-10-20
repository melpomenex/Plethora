## ADDED Requirements

### Requirement: Learning Agent in the existing Assistant

The user SHALL be able to explicitly invoke Learning Agent mode through the existing Assistant on mobile and desktop and through an available command-palette action. Runs, messages, source attachments and review artifacts SHALL belong to the current Assistant conversation. The enabled preference and current capability/consent state SHALL gate invocation.

#### Scenario: Cards from a chapter
- **WHEN** the user selects Learning Agent mode with an identifiable chapter attached and requests cards
- **THEN** the existing conversation shows bounded progress and reviewable source-grounded card proposals

#### Scenario: No model or disabled feature
- **WHEN** the feature is disabled or no permitted generation route is available
- **THEN** the action does not start a run and the Assistant offers the relevant setup explanation

#### Scenario: Palette opens mode
- **WHEN** a palette action opens Learning Agent mode
- **THEN** it opens the existing Assistant without starting inference until the user submits

### Requirement: Agent source scope and provenance

Every tool and proposed object SHALL be bound to the frozen authorized source scope, including stable source locations and revisions where available. Retrieved and model content SHALL remain untrusted. The agent SHALL NOT fabricate library IDs, citations or document associations, and SHALL disclose missing or partial material.

#### Scenario: Three-paper request
- **WHEN** a run retrieves evidence from three attached papers
- **THEN** each proposal identifies the actual supporting paper and location rather than inheriting the currently visible document

#### Scenario: Source removed or edited
- **WHEN** an attached source is removed or changes before approval
- **THEN** affected tool access and approval are blocked until the user revalidates the source

#### Scenario: Malicious source directive
- **WHEN** retrieved text requests out-of-contract tools or mass creation
- **THEN** the directive cannot change tool authority, bounds or approval requirements

### Requirement: Incremental progress and complete cancellation

Runs SHALL expose tool-use progress, navigable source references and bounded partial-result explanations. Stop, conversation/source changes, disabling the feature and teardown SHALL prevent further generation, tool work and unapproved writes. The run deadline SHALL include slow tools and any final-answer attempt.

#### Scenario: Tool budget exhausted
- **WHEN** a request reaches the existing tool or proposal limit
- **THEN** it stops with available validated drafts and a specific partial-result explanation

#### Scenario: Slow retrieval crosses deadline
- **WHEN** retrieval remains pending beyond the run deadline
- **THEN** the run terminates without starting another model turn and late results cannot update the conversation

#### Scenario: Conversation changed during run
- **WHEN** the user switches conversations during generation
- **THEN** the former run cannot append content or proposals to the new conversation or trigger cloud fallback

### Requirement: Agent proposals use validated individual approval

All proposed cards, clozes, extracts, tags, occlusions and available relationships SHALL use the existing editable approval workflows. Source grounding, duplicate checks and caps SHALL be enforced before preview and after edits. No unapproved proposal SHALL create a permanent learning object.

#### Scenario: Edit and approve a subset
- **WHEN** the user edits one candidate and approves two of five
- **THEN** only those two validated candidates are saved and the other three remain unsaved

#### Scenario: Duplicate or unavailable duplicate check
- **WHEN** a candidate duplicates an existing item or uniqueness cannot be checked
- **THEN** the issue is visible and ordinary acceptance cannot silently bypass it

#### Scenario: Unsupported relationship proposal
- **WHEN** relationship authoring is unavailable for the current build or policy
- **THEN** the tool reports the limitation and creates no link

### Requirement: Retry-safe agent acceptance

Saving SHALL preserve actual per-candidate source associations and generation provenance, distinguish partial failures and prevent duplicate creation on repeated or ambiguous retries. A cancelled or failed save SHALL report already committed objects accurately. Restoring a conversation SHALL never resume agent execution automatically.

#### Scenario: Persistence fails after one group saves
- **WHEN** one approved source group saves and a later group fails
- **THEN** the first group's saved IDs remain visible and retry targets only unsaved candidates

#### Scenario: Response lost after commit
- **WHEN** a save committed but its response is lost and the user retries
- **THEN** the original objects are recovered without creating duplicates

#### Scenario: Provenance write fails
- **WHEN** a card exists but required source metadata recording fails
- **THEN** the UI distinguishes saved content from incomplete metadata and retries metadata without recreating the card

### Requirement: Destination-aware agent authorization

Private retrieval queries and source material SHALL be processed only by an authorized destination and within the user's bounded cost/privacy scope. Local execution SHALL use existing routing where supported; a change to an external or billable destination SHALL require applicable explicit consent. Diagnostic output SHALL contain no source, prompt or completion text.

#### Scenario: External fallback declined
- **WHEN** local generation fails and the user declines the proposed external retry
- **THEN** no source text or query is sent to that destination and existing drafts remain available

#### Scenario: Local configured endpoint
- **WHEN** an authorized local endpoint serves a run
- **THEN** privacy presentation reflects the endpoint's actual local status rather than its internal provider category
