# Implementation Tasks

## 1. Model & storage
- [ ] 1.1 Migrations: `learning_goals`, `learning_paths`, `learning_path_nodes` (versioned, user_modified flags) — next free numbers; re-anchor rule
- [ ] 1.2 `src-tauri/src/learning_paths/` + `commands/learning_paths.rs`: CRUD, progress queries, node status transitions

## 2. Planning
- [ ] 2.1 Deterministic planner (topological weak-first over 9's graph queries + 10's mastery/gaps + source availability) with property tests
- [ ] 2.2 `path-generation` task (topic decomposition, rationales, material-gap detection) — local + BYO + cloud capability routes
- [ ] 2.3 Adaptation engine: triggers, subgraph re-plan, version diffs, user-modification preservation
- [ ] 2.4 Progress signal mapping (reads/extracts/cards/mastery delta)

## 3. UX
- [ ] 3.1 Goal creator (NL goal + scope picker); PathView DAG (e-ink safe); NodeCard with sources/rationale/progress
- [ ] 3.2 Edit actions: reorder/add/remove/skip/lock; version diff review before accepting regeneration
- [ ] 3.3 Queue composition additive source ("today's path items", default off) + dashboard section
- [ ] 3.4 Entry points from gaps (10) and graph nodes (9); `path-updated` events; i18n 6 locales

## 4. Validation
- [ ] 4.1 Fixture E2E: canonical OS-curriculum scenario with citations and stable ordering
- [ ] 4.2 Queue composition regression suite green (or baselines updated per protocol); full gates
