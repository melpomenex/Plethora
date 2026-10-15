# Change: Implement Plethora AI-Generated Adaptive Learning Paths

> Wave 2 — Intelligence (after 7, 9, 10; consumes gap signals). Capability: `adaptive_learning_paths`. Local generation via on-device/BYO available; Plethora-hosted generation capability-gated.

## Why

"I want to understand operating systems" should yield an adaptive progression through the user's own materials — Processes → Scheduling → Concurrency → Memory → Virtual Memory → File Systems → Networking — ordered by prerequisites, estimated mastery, and review history; adapting as the user studies. Paths convert the library from a pile into a curriculum the user can trust and modify.

## What exists today
- Reading queue with priority/ordering machinery (`queueStore`, `priority_queue.rs`, `queue_selector.rs`), postpone engine, queue composition sliders — operational backbone paths can feed into.
- Concept graph with `prerequisite-of` relations (9), mastery estimates and gaps (10), semantic retrieval (7), reading goals (`models/reading_goal.rs` + goal components), analytics rollups.
- No curriculum/plan structure exists (closest: reading goals are time-based, not topology-based).

## What Changes

### 1. Goal & path model
- New tables (next free numbers): `learning_goals { id, title, description, scope (collection/filters), status, created_at }`; `learning_paths { id, goal_id, version, graph_snapshot_ref, status }`; `learning_path_nodes { id, path_id, concept_ref, source_refs[] (documents/extracts/cards), order_index, prerequisite_node_ids[], estimated_mastery_start, target_mastery, status: pending|active|completed|skipped, user_modified }`.
- Node sources cite library items via `RagCitation`-style refs (document ids + locators); nodes without library sources are **material-gap markers** (link to Find material flows / proposal 10 actions).

### 2. Generation pipeline
- Task `path-generation` (structured output): input = goal + graph neighborhood (`prerequisite-of` subgraph within scope) + per-concept mastery estimates (10) + gap list + queue state + available sources; output = ordered nodes with per-node rationale (`why_here`: prerequisites satisfied, mastery gap, source availability).
- Determinism: topology comes from the graph + mastery rules (Kahn-style ordering over prerequisite edges, weak-first); the model writes rationales/splits topics into nodes — not free-form order (explainability + stability).
- Regeneration is versioned; diffs between versions shown (added/removed/reordered nodes with reasons) before acceptance.

### 3. Adaptation
- Triggers: node completion, new gaps in path concepts (10), significant mastery shifts, new relevant material imported. Adaptation = re-run planning on the affected subgraph; mid-path changes respect user modifications (locked nodes/orders preserved unless impossible, with explanation).
- Progress: per-node progress from existing signals (reads, extracts created, cards reviewed, mastery estimate delta toward target).

### 4. UX
- **Goal creation**: natural-language goal + scope picker (collections/tags/existing search).
- **Path view**: vertical DAG visualization (simple, e-ink safe; not the 3D universe), node cards with sources, rationale, progress; user actions: reorder (creates user_modified), add/remove node, mark complete/skip, lock.
- **Integration into daily flow**: an active path surfaces as a queue feed option ("Today's path items" via existing queue composition machinery — additive composition source, default off) and on the dashboard. Completion criteria: target mastery reached per terminal nodes (estimate-based, honest) or user-declared.

### 5. Local vs cloud
- Local: graph+rules planning works without any LLM (ordering/mastery logic is deterministic); rationales optional. BYO/Nano for richer generation.
- Cloud (`adaptive_learning_paths` capability): job-based generation with better models; inputs = compact structured summaries (concept list, mastery values, source metadata — not raw content unless the model needs excerpts, disclosed); exclusion flags honored.

## Impact

### Affected Specs
- `adaptive-learning-paths` — New (goal/path model, generation determinism, adaptation, user modification precedence, progress semantics).

### Affected Code Areas
- New `src-tauri/src/learning_paths/`, `commands/learning_paths.rs`, migrations; `src/lib/ai/tasks/definitions/pathGenerationTask.ts`; `src/stores/learningPathsStore.ts`; `src/components/paths/{GoalCreator,PathView,NodeCard,PathDiff}.tsx`; queue composition additive source; dashboard section; i18n.

### Non-goals
- No tutoring implementation (12), no card generation (13), no external course import, no social/sharing, no scheduling-algorithm changes (paths feed the existing queue).

## Dependencies

### Hard dependencies
- 7 (sources/citations), 9 (graph), 10 (mastery/gaps). Soft: 13 (node→cards actions), queue machinery exists.

### May run concurrently
- 12, 14, 15 (disjoint surfaces; shared consumption of 10's contract).

### Must not start yet
- — (final intelligence-wave consumer).

## Shared interfaces
- `learning_path` commands (create goal, generate, adapt, query progress, modify nodes); `path-node` schema; queue composition source registration; consumed contracts: `neighborhood`/`path` graph queries (9), `list_gaps`/mastery (10), `rag_query` (7).

## Ownership boundaries
- **May modify**: new learning_paths modules/UI, queue composition additive registration, dashboard additive section.
- **Must treat as external**: queue scheduling internals (register as source only), graph/gap schemas, tutor/card-gen APIs.

## Collision risks
- Queue composition code (`queueScroll*`, `queueStore` filters — additive only); AnalyticsPage/dashboard sections (10/15 also add — coordinate mounts); migration numbering.

## Integration contract
- Emits `path-updated` events; node completion can trigger 12 (tutor) and 13 (card) entry points with context; progress consumed by 15 dashboards.

## Testing & acceptance

### Tests
- Planning determinism: given fixture graph+mastery, node order is stable and prerequisite-respecting (topological invariants; property tests).
- Adaptation: completing nodes/gaining mastery re-orders remainder; user-locked nodes survive regeneration; version diffs accurate.
- Progress: signals map to node progress correctly (extract created on node source counts).
- Queue integration: path feed composes with existing filters without breaking composition tests (`queueScrollOrder` benches unaffected or baselines updated per protocol).
- E2E fixture: "understand operating systems" over a seeded library yields the canonical ordering example with citations.

### Acceptance criteria
- A goal over the fixture library produces an explainable, editable, adaptive path; daily queue can include path items; regeneration shows diffs; local rules-only mode produces valid paths without LLM.

### Must remain unchanged
- Existing queue behavior when no path is active; scheduling algorithms; existing perf gates.

## Open questions
1. Default adaptation aggressiveness (re-plan threshold tuning).
2. Whether target mastery values are user-adjustable globally (default: per-goal advanced setting).
3. Material-gap nodes: auto-suggest imports (arXiv/web) or passive markers only (default passive + one-click search).
