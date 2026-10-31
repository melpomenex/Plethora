# Learning Agent routing, contract, and orchestration repair

## ADDED Requirements

### Requirement: Selected provider and model fidelity for agent runs

The Learning Agent SHALL run on the provider and model the user explicitly selected in the Assistant at submit time when that selection is permitted and capable of serving the request. The selected configuration SHALL be frozen for the duration of a run, the actual serving provider and model SHALL be visible in sanitized diagnostics and surfaced beside the answer, and the run SHALL NOT silently substitute another provider, model, billing destination, or privacy destination. An incompatible selection SHALL fail typed before transmission with a specific blocker and an explicit recovery path, and a permitted explicit retry SHALL use the user's selection.

#### Scenario: Picker selection serves the run

- **GIVEN** three provider configurations are enabled in the provider store
- **WHEN** the user selects OpenRouter in the Assistant picker and requests cards
- **THEN** every generation request of the run is served by the OpenRouter configuration the user selected
- **AND** no other enabled provider (for example a first-in-list Ollama row) serves any turn

#### Scenario: First-enabled fallback is not substituted

- **GIVEN** the first enabled provider row differs from the picker selection
- **WHEN** the run is submitted
- **THEN** the run uses the picker selection, never the first-in-list configuration

#### Scenario: Mid-run configuration drift is impossible

- **GIVEN** a pinned run using the user's selected model
- **WHEN** a different provider row is enabled or edited during the run
- **THEN** the serving configuration cannot change mid-run
- **AND** an edit to the selected configuration stops the run with the existing destination-changed guard

#### Scenario: Incompatible selection fails typed

- **GIVEN** the user's selected provider is disabled, missing credentials, or cannot serve a structured agent turn
- **WHEN** the user submits a Learning Agent request
- **THEN** the run does not start and the blocker names the selected provider with an explicit recovery target

#### Scenario: Serving model is disclosed

- **GIVEN** any completed run
- **WHEN** the answer or run diagnostics are shown
- **THEN** the disclosure identifies the provider and model that actually served the requests
- **AND** a permitted route difference from the selection is stated as a disclosure, never as a silent substitution

### Requirement: Deterministic grounding seat for scoped actions

When a Learning Agent run's frozen scope already resolves a section or selection deterministically, the system SHALL read that source through the frozen environment, register it in the run's evidence map, and seed the initial untrusted transcript with its bounded text before the first model turn. The seeded evidence SHALL use the same application-assigned opaque handles as tool-returned evidence, and library-scope or exploratory actions SHALL remain search-driven without fabricated seeding. Source text SHALL reach the model only inside untrusted containment blocks and within the established prompt budget.

#### Scenario: Cards from a seeded section

- **WHEN** the user selects a section with ≈1,000 tokens of readable text and requests cards
- **THEN** the first model turn already contains the section text as an untrusted block with the registered handle
- **AND** a protocol-correct model can produce grounded card proposals citing that handle without an intermediate retrieval turn

#### Scenario: Tool remains the authority for re-resolution

- **GIVEN** a seeded run
- **WHEN** any tool call resolves the section again
- **THEN** the tool result and the seeded text agree and both circumstances use registered handles only

#### Scenario: Scope-resolution failure is typed

- **GIVEN** the frozen section text cannot fit the selected model's prompt budget
- **WHEN** the seat step cannot produce the bounded content
- **THEN** the run ends with a source-specific typed error, no generation call, and guidance to select a smaller scope

#### Scenario: Library scope stays agentic

- **WHEN** the intent requires library-wide retrieval
- **THEN** no seeded body text is injected and the model discovers sources only through authorized retrieval tools

### Requirement: Agent-turn output protocol

The agent-turn envelope SHALL be a machine-enforceable contract (registered tool-name enum, typed optional fields, explicit either/or semantics for tool calls versus final answer, compact single-line JSON requirement, and a validator-asserted realistic example without placeholder literals). A turn possessing neither executed tool calls nor a final answer SHALL be a typed protocol failure with bounded recovery, not a silently accepted no-op; unknown tool names SHALL remain in-contract rejections executed against the registry allowlist. Every turn shape SHALL be classified (tool calls, final answer, empty, invalid) and counted in diagnostics.

#### Scenario: Empty turn triggers bounded recovery

- **GIVEN** the model responds with a turn containing neither tool calls nor a final answer
- **WHEN** the loop processes the response
- **THEN** one corrective recovery request is attempted with explicit contract guidance
- **AND** a further off-contract turn ends the run with a typed agent-protocol failure and an accurate explanation

#### Scenario: Placeholder echo is rejected precisely

- **WHEN** a turn copies literal placeholder values from a previous schema example (for example a tool named `tool_name` or a final answer equal to the legacy placeholder text)
- **THEN** validation rejects the turn with an error that names the echoed placeholder
- **AND** the value never reaches the registry as a tool call nor the conversation as an answer

#### Scenario: Unknown tool name stays in-contract

- **GIVEN** a turn calling an unregistered tool name
- **THEN** the call is answered with a typed rejected tool result the model can see
- **AND** the contract failure class is not used for it

### Requirement: Model-facing tool contract accuracy

Every registered agent tool SHALL expose a typed parameter descriptor (names, types, requiredness, bounds, enums) as the single source of truth for both the model-facing catalog text and the runtime input contracts. The catalog SHALL state each tool's argument contract so a capable model can construct valid arguments for every registered tool. Descriptor and validator SHALL be proven consistent by automated cross-checking, and runtime allowlist and input validation SHALL NOT be weakened.

#### Scenario: Catalog states the proposal contract

- **GIVEN** the proposal tools
- **WHEN** the agent turn's model-facing catalog is built
- **THEN** `propose_flashcard` documents required `question`/`answer` strings with bounds, the `cardType` enum, optional handle and evidence fields, and the unit-creation limit
- **AND** the source-handle semantics (application-issued handles only) are explicit

#### Scenario: Descriptor and validator cannot drift

- **GIVEN** every registered tool's descriptor
- **WHEN** the contract cross-check runs
- **THEN** inputs that violate the descriptor (unknown key, wrong type, exceeding length, out-of-enum value, missing required field) are always rejected by the tool's runtime validator

#### Scenario: Argument-shaped mass creation stays impossible

- **GIVEN** a source instructs one-item-per-call rules or cap escalations
- **THEN** unknown parameters and caps remain rejected exactly as before this change

### Requirement: Model capability negotiation for agent runs

Learning Agent preflight SHALL consult the selected provider's declared capabilities against the agent turn's requirements (structured/strict-JSON output support, context window fitted to the prompt and output budget, on-device native structured-envelope support where the bridge verifies it) and SHALL declare, in blocker or disclosure text, when the selected model is likely incompatible with the agent turn protocol. A provider's chrome SHALL NOT infer native tool-calling or schema enforcement from plain-chat success alone; provider-native structured output SHALL be used only when a wire-verified fixture exists for that provider family and the provider reports the capability. A first-run protocol probe MAY validate agent-turn compliance for a selected provider/model pair, bounded in size and frequency, triggered only by an explicit run submission under the same privacy and billing consent as the run, never by passive settings display, and cancellable like any run stage.

#### Scenario: Declared capability mismatch blocks with explanation

- **GIVEN** the selected model's context cannot fit the agent prompt and output reserve
- **WHEN** the user submits a Learning Agent request
- **THEN** the run is blocked before transmission
- **AND** the blocker explains the incompatibility and offers a recovery target (choose a stronger model or reduce scope)

#### Scenario: Plain-chat compatibility is never assumed

- **GIVEN** a provider that successfully serves chat requests
- **THEN** that result alone SHALL NOT mark the provider as agent-turn compatible in diagnostics or UI

#### Scenario: Probe is bounded and consented

- **GIVEN** a first-ever agent run for the selected provider/model pair
- **WHEN** the capability probe executes
- **THEN** it uses a minimal deterministic prompt within the run's deadline and signal
- **AND** it is skipped entirely when its implementation is not wired (no behavior change), and repeated persistent failures surface a typed compatibility warning rather than silent substitutions

### Requirement: Honest progress, outcomes, and route diagnostics

Agent runs SHALL classify completion truthfully: repair of protocol turn failures SHALL be bounded and described (attempted/succeeded counts), bounds-based endings SHALL NOT be recorded as successful generation, progress SHALL be defined semantically over executed in-contract tool calls, and diagnostics SHALL record the serving provider/model, output mode, turn/tool/proposal outcome counts, and seeded-context facts without storing source, prompt, or completion text. User-facing messages SHALL distinguish model-protocol failures, tool failures, provider failures, missing sources, incomplete bounded runs, and cancellations through localized end-reason keys.

#### Scenario: Bound endings are reported as incomplete

- **GIVEN** a run ending with turn-budget, tool-budget, proposal-budget, retrieval-hops, loop-detected, or timeout
- **WHEN** the generation-stage observation is recorded
- **THEN** the outcome is classified as incomplete or partial, never success
- **AND** the explanation names the specific bound and what was preserved

#### Scenario: Failure taxonomy is precise

- **GIVEN** an empty provider body, a truncated JSON envelope, and a refusal-only response from the same provider
- **THEN** diagnostics record three distinguishable task-layer outcomes (empty, truncated length, off-contract text)
- **AND** the user-facing message corresponds to the actual stage rather than a generic agent error

#### Scenario: Route provenance in diagnostics

- **GIVEN** any run with a provider-observing test or the developer trace export
- **THEN** the export names selected/served provider and model, output mode, and all run counters
- **AND** exports contain no document, prompt, or completion content

### Requirement: Card quantity and proposal efficiency

Flashcard generation SHALL target a sensible default (approximately 5 high-value cards) when the user does not specify a count, SHALL honor explicit requested counts up to the run's proposal budget, and SHALL minimize unnecessary model round trips through batched proposal tools that emit multiple validated candidates per call. Partial results SHALL remain fully usable and reviewable; caps (proposal budget, per-turn tool calls, preview caps) SHALL remain hard boundaries enforced by application logic regardless of model output.

#### Scenario: Default count from a seeded section

- **WHEN** a protocol-correct model serves a seeded flashcard run without an explicit count
- **THEN** the run yields roughly 3–6 validated candidates within one to three model turns
- **AND** every candidate binds a registered handle and passes the existing approval flow

#### Scenario: Explicit larger count stays bounded

- **GIVEN** the user asks for 20 cards
- **WHEN** the run ends at the tool or proposal bound
- **THEN** the validated subset is delivered as a usable partial result with an accurate explanation

#### Scenario: Batch call rejects per item

- **GIVEN** a batch proposal call containing valid and invalid drafts
- **THEN** each draft is validated individually, valid ones are proposed, and invalid ones return typed per-item errors
- **AND** the proposal cap remains authoritative even inside a batch

## MODIFIED Requirements

### Requirement: Bounded execution

Agent execution SHALL be bounded: a maximum number of tool calls, maximum proposals, wall-clock
timeout, retrieval depth limit, and recursion/iteration limits. Unbounded loops SHALL be impossible.

In addition, protocol-level recovery after off-contract turns SHALL be bounded (at most one
corrective recovery turn per run plus at most two corrective notes, all inside the existing
turn, tool, and wall-clock budgets), and no bound-based ending SHALL be presented or recorded as
complete success.

#### Scenario: Tool-call budget exhausted

- **WHEN** an agent run reaches its tool-call cap before completing
- **THEN** the run terminates gracefully with a partial-result explanation

#### Scenario: Recursive loop prevented

- **WHEN** tool usage patterns repeat without progress
- **THEN** the loop is detected and the run ends within the iteration limit

#### Scenario: Recovery stays inside the budgets

- **GIVEN** a model that repeatedly produces off-contract turns
- **WHEN** the run exhausts its one recovery attempt
- **THEN** the run ends with a typed agent-protocol failure
- **AND** no unbounded turn escalation, auto-restart, or provider substitution occurs
