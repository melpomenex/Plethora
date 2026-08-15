## ADDED Requirements

### Requirement: Constrained tool layer

The agent SHALL operate exclusively through a registered tool set: read-only library/context
tools first (search, current document/selection, recent reading context, related material,
existing cards, review history, due cards), then proposal tools (propose extract, flashcard,
cloze, occlusion, tag, link). Tool arguments and results SHALL be structured and validated;
unsupported parameters SHALL be rejected.

#### Scenario: Read-only query fulfilled
- **WHEN** the user asks "find my existing cards about this concept"
- **THEN** the agent answers via validated read-only tools with navigable references

#### Scenario: Hallucinated IDs are rejected
- **WHEN** a tool call references a non-existent or unowned record id
- **THEN** the call is rejected by validation and the agent is informed within its bounds

### Requirement: Writes require user approval

Agent output that would create durable objects SHALL end in the same preview/validation/
approval flows as direct features. The agent SHALL NOT mutate the database directly, and no
unrestricted filesystem or database access SHALL exist.

#### Scenario: Card-creation intent becomes a reviewable proposal
- **WHEN** the user says "take the three most important ideas from what I just read and make
  cards"
- **THEN** the agent returns at most the bounded set of validated candidates in the standard
  preview UI and nothing is created until approved

### Requirement: Bounded execution

Agent execution SHALL be bounded: a maximum number of tool calls, maximum proposals, wall-clock
timeout, retrieval depth limit, and recursion/iteration limits. Unbounded loops SHALL be
impossible.

#### Scenario: Tool-call budget exhausted
- **WHEN** an agent run reaches its tool-call cap before completing
- **THEN** the run terminates gracefully with a partial-result explanation

#### Scenario: Recursive loop prevented
- **WHEN** tool usage patterns repeat without progress
- **THEN** the loop is detected and the run ends within the iteration limit

### Requirement: Prompt-injection resistance

Document and tool-result text SHALL be treated as untrusted data in agent prompts (delimited
untrusted blocks; never system-level instructions). Instructions embedded in sources SHALL
NOT cause out-of-contract tool use, and the system instruction SHALL define the full tool
contract independently of any source content.

#### Scenario: Source-embedded tool directive is ignored
- **WHEN** a document contains text instructing the model to call destructive tools or mass
  create cards
- **THEN** no such tool calls occur and the turn completes within contract

#### Scenario: Mass-creation attempt bounded
- **WHEN** any path attempts to exceed proposal caps
- **THEN** validation enforces the caps regardless of model output

### Requirement: Execution tracing

Agent runs SHALL record an execution trace (tool, argument digest, duration, outcome
category) in diagnostics without storing user content by default, with an explicit developer
debug mode for detailed inspection.

#### Scenario: Trace available for debugging
- **WHEN** a developer enables AI debug diagnostics after an agent run
- **THEN** they can inspect the sequence of tool calls, bounds consumed, and outcome
  categories
