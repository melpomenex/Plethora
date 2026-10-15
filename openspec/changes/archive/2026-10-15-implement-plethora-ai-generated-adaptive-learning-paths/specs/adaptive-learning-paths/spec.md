## ADDED Requirements

### Requirement: Paths derive from library structure, not free-form generation
Node ordering SHALL be computed deterministically from the concept graph's prerequisite relations, mastery estimates, and available sources (topological, weak-first), with the LLM confined to topic decomposition and rationales. Every node SHALL carry a `why_here` rationale and source references into the user's library, or be an explicit material-gap marker.

#### Scenario: Ordering respects prerequisites
- **WHEN** a path is generated over a fixture graph where virtual memory requires memory which requires processes
- **THEN** the node order is topologically valid and reproducible across regenerations with unchanged inputs

#### Scenario: Material gaps are explicit
- **WHEN** a required concept has no covering source in the library
- **THEN** the node is marked as a material gap with find-material actions rather than silently omitted

### Requirement: Adaptation preserves user modifications
Path adaptation (triggered by completion, mastery shifts, new gaps, or new material) SHALL produce a new version with a reviewable diff. User-reordered/locked/added/removed nodes SHALL be preserved unless structurally impossible, with any forced change explained. Acceptance of a new version is explicit.

#### Scenario: Locked node survives re-planning
- **WHEN** a path regenerates after the user locked a node's position
- **THEN** the diff shows the lock respected or an explicit impossibility explanation

### Requirement: Progress is signal-based and honest
Node progress SHALL derive from existing signals (reads, extracts, card reviews, mastery-estimate movement toward target). Path completion SHALL require terminal-node target mastery (estimate-based) or explicit user declaration — never inflated by activity metrics alone.

#### Scenario: Reading alone doesn't complete nodes
- **WHEN** a user reads all node sources but creates no cards and shows no mastery movement
- **THEN** nodes remain in progress with reading progress shown separately from mastery progress

### Requirement: Paths integrate as an optional queue feed
An active path SHALL be able to feed "today's path items" into the existing queue composition machinery as an additive source (default off), without altering scheduling algorithms or non-path behavior.

#### Scenario: Path feed composes safely
- **WHEN** the path feed is enabled alongside existing queue filters
- **THEN** composition semantics follow existing composition rules and existing queue tests/benches remain valid

### Requirement: Local-first with capability-gated generation
Rules-based planning SHALL function locally without any LLM or subscription. Model-assisted decomposition/rationale SHALL run via on-device/BYO backends or, under `adaptive_learning_paths`, as quota-bounded cloud jobs over compact structured inputs, honoring AI-exclusion flags with disclosed data flow.

#### Scenario: No-LLM path is valid
- **WHEN** generation runs with all AI disabled
- **THEN** a valid, ordered, source-cited path is produced (rationales omitted)

### Requirement: Goals are first-class and scoped
Goals SHALL capture a natural-language objective plus scope (collections/tags/search); paths SHALL be versioned per goal with full history; deleting a goal removes paths but never underlying library data.

#### Scenario: Scoped generation
- **WHEN** a goal is scoped to a single collection
- **THEN** only that collection's concepts/sources inform the path
