# Implementation Tasks

## 1. Schema & repository (owned here)
- [ ] 1.1 Migrations: concept aliases/definitions/type columns, edge evidence/provenance table, merge audit, orphan state (next free numbers; re-anchor rule)
- [ ] 1.2 `concept_repository.rs` evolution: neighborhood/path/search SQL queries with budgets, alias resolution, merge with provenance union
- [ ] 1.3 Commands: `concept_graph_*` (neighborhood, path, search, node detail, merge/split/rename/delete, candidate-merge queue) + events

## 2. Extraction pipeline
- [ ] 2.1 `graph-extraction` task (structured output: concepts, edges, evidence quotes) with validation/repair
- [ ] 2.2 Entity resolution: normalization + embedding candidates + conservative merge thresholds + review queue
- [ ] 2.3 Indexer integration: change-driven extraction with fingerprint staleness, budget/battery gates; deletion → orphan-marking
- [ ] 2.4 Cloud job kind for extraction (capability, quota, no persistence, exclusion flag)
- [ ] 2.5 Golden-fixture extraction tests + precedence (user > AI) tests

## 3. Visualization & navigation
- [ ] 3.1 Concept data mode for `KnowledgeGraph` + `KnowledgeUniverse` (lazy/clustered, node-budget caps, aggregation)
- [ ] 3.2 Node/edge detail panels with provenance lists, correction actions (rename/merge/delete/lock), sources & related-cards links
- [ ] 3.3 Search-to-node, path-between-concepts, neighborhood expansion; e-ink/low-perf static variant
- [ ] 3.4 Graph export (JSON/CSV) extension

## 4. Validation
- [ ] 4.1 SQL perf test at 50k nodes / 250k edges within p95 budget (seeded)
- [ ] 4.2 Component virtualization test under oversized fixture; visual regression unchanged for existing modes
- [ ] 4.3 Downstream contract tests (10/11 query shapes); `graph-updated` event tests
- [ ] 4.4 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)
