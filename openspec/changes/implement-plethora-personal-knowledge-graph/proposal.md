# Change: Implement Plethora Personal Knowledge Graph

> Wave 2 — Intelligence (after 7; parallel with 8/13). Capability: `knowledge_graph` (cloud-assisted extraction); local extraction via on-device/BYO backends available. **This change owns the `concepts`/`concept_links` schema and its evolution.**

## Why

A structured representation of the user's knowledge — concepts, people, works, claims, definitions, and their relationships, every edge traceable to source documents — powers navigation ("map what I know"), gap detection (10), and learning paths (11). The hard requirement is **practical value over decoration**: edges must carry provenance, the graph must support correction, and it must feed downstream features rather than just render prettily.

## What exists today
- **Backend, unpopulated**: `concepts` + `concept_links` tables (typed relations with confidence, `proposal_fingerprint`, dismissal state, `created_by` ai/user), `concept_repository.rs` with `CONCEPT_RELATION_TYPES` (10 types) and `MAX_AI_LINKS_PER_DAY=200`, commands `upsert_concept`, `propose/accept/dismiss/delete_concept_link`, backlinks queries — implemented in Rust with **zero frontend callers**.
- **Visualizations**: `src/components/graph/KnowledgeGraph.tsx` (2D canvas; node types document/extract/flashcard/category/tag/rss), `KnowledgeUniverse.tsx` (three.js WebGL engine, `graph/universe/engine.ts` — render-on-demand, picking, camera fit), `KnowledgeSpherePage`/`KnowledgeNetworkTab`, `NodeDetailPanel`, `GraphFilters`, `GraphExport`. Currently fed by document/tag structure (`compute_semantic_graph` over `queue_item_embeddings`).
- **Semantic layer** (7): chunks + retrieval + citations; `ai_provenance`.
- Entity extraction: nothing dedicated (LLM structured-output chain in `runTask` is the pattern).

## What Changes

### 1. Entity/concept extraction pipeline
- New task `graph-extraction` (structured output): per chunk or per accepted-connection context, extract `{ concepts: [{name, type, aliases, definition?}], edges: [{type, from, to, confidence, evidence_quote, source}] }` with types beyond the current 10 relations where needed (add `CONCEPT_RELATION_TYPES` values additively: `part-of`, `causes`, `compares-to` if extraction quality demands; schema change owned here).
- Entity resolution: alias/normalization pass (case, plurals, synonym table seeded from `same-as` links) + embedding-similarity candidate matching (reuse index) + **conservative merge policy** (only auto-merge ≥ high threshold or `same-as`; otherwise candidate-merge queue for the user).
- Duplicate merging with edge re-parenting and provenance union (merge never loses an evidence citation).
- Scheduling: extraction rides the indexer's battery/change gates (7); incremental (changed documents re-extract with fingerprint staleness); deletion cascades to edges (soft: edges keep provenance records, marked orphaned if a source document is deleted).

### 2. Provenance & correction
- Every edge carries ≥1 `evidence` entry (`RagCitation` + quote). Node/edge detail panels list provenance; users can: rename concept (alias-preserving), merge/split nodes, delete edges (AI edges deletable; provenance retained in audit), pin/lock user-authored edges against AI overwrites.
- Human corrections stored with `created_by='user'` and precedence over AI re-extraction (re-extraction may propose, never overwrite).

### 3. Visualization & navigation (evolve existing components)
- New data mode for `KnowledgeGraph`/`KnowledgeUniverse`: concept-graph feed alongside the existing document/tag modes (user picks; default concept mode when populated). Lazy/clustered rendering for scale: viewport-limited node budget (e.g. ≤ 800 visible, aggregation beyond), incremental pan-load — never load the entire graph into UI memory.
- Navigation: search-to-node, path-between-two-concepts (edge-hop view), neighborhood expansion on click; node → sources (citations), node → related cards (13), node → connections (8).
- Export: graph JSON/CSV export (extends `GraphExport`).

### 4. Scaling & performance
- Graph queries via SQL (recursive CTEs for neighborhoods) — no in-memory full-graph materialization; extraction bounded by the daily budget and battery gates; visualization budget-capped (render-on-demand engine already proven).

### 5. Local vs cloud
- Local extraction (Nano/BYO) available to all — graph building is local-first.
- Cloud extraction (`knowledge_graph` capability): job-based higher-quality extraction (batches of chunks; quota = tokens; no server persistence beyond job TTL; AI-exclusion honored).

## Impact

### Affected Specs
- `knowledge-graph` — New (extraction, resolution/merge, provenance, correction precedence, scaling budgets, visualization modes).

### Affected Code Areas
- `concept_repository.rs` + `commands/concept_links.rs` evolution (owned here); new `commands/concept_graph.rs`; migration(s): concept aliases/definitions columns, evidence/provenance table for edges, merge audit (next free numbers); `src/lib/ai/tasks/definitions/graphExtractionTask.ts`; `graph/` components new data mode; i18n.

### Non-goals
- No public/shared graphs, no graph-based recommendations beyond inputs to 10/11, no manual graph editor beyond correction actions (merge/rename/delete), no RDF/external ontology import (export only).

## Dependencies

### Hard dependencies
- Proposal 7 (chunks/retrieval/citations + indexer gates).

### Soft dependencies
- Proposal 8 (accepted connections seed edges); 13 (cards as node-adjacent objects read-only).

### May run concurrently
- 8, 13 (contracts: this change owns concept schema; 8 produces via existing commands).

### Must not start yet
- 10, 11 (consume graph signals).

## Shared interfaces (owned here)
- `concepts`/`concept_links` schema + all concept commands; graph query API (`neighborhood(node, depth, budget)`, `path(a,b)`, `search(q)`); `graph-extraction` task; concept-graph data feed for visualizations.

## Ownership boundaries
- **May modify**: concept repository/commands/schema, graph components' data modes, extraction task.
- **Must treat as external**: retrieval internals (7), suggestion workflow volume (8 owns its lifecycle; writes through commands owned here), visualization engines' internals (add data modes only).

## Collision risks
- `concept_repository.rs`/`commands/concept_links.rs` (8 writes through them — additive methods only from 8); `graph/` components (only this change adds concept mode); migration numbering re-anchor.

## Integration contract
- Exposes typed graph queries + evidence-bearing edges; emits `graph-updated` events; 10/11 consume `neighborhood`/`path`/relation queries without touching schema.

## Testing & acceptance

### Tests
- Extraction: fixture-document golden tests (entities, edges, evidence quotes map to real chunk ranges); relation-type validation; quota/budget enforcement.
- Resolution/merge: alias normalization; conservative auto-merge thresholds; merge preserves union of provenance; re-extraction never overwrites user edges (precedence test).
- Deletion: document delete → edges orphan-marked, not silently dropped; re-import restores linkage via fingerprints.
- Queries: neighborhood depth/budget bounds; path correctness on fixture graph; SQL-level performance test at 50k nodes/250k edges within p95 budget (Rust test, seeded data).
- Visualization: node-budget cap respected under huge graphs (component test with virtualized fixture); e-ink/low-perf mode renders static.

### Acceptance criteria
- After indexing a fixture library, the graph shows concepts with source-traceable edges; user corrections stick against re-extraction; navigation between concepts and into sources works; downstream queries (10/11 contracts) answer within budgets.

### Must remain unchanged
- Existing document/tag graph modes; `MAX_AI_LINKS_PER_DAY` guard behavior; visual perf baselines.

## Open questions
1. Concept type taxonomy v1 (concept/person/work/claim/definition/topic — how many, how displayed).
2. Whether flashcards become first-class graph nodes or cited sources on concept nodes (default: latter).
3. Auto-merge threshold calibration (ship conservative; tune from telemetry-free local evaluation fixtures).
