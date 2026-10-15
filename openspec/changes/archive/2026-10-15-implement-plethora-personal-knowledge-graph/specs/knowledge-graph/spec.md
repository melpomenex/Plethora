## ADDED Requirements

### Requirement: Graph edges always retain provenance
Every concept relation SHALL carry at least one evidence entry (citation + quote resolvable to a library source). Edges without resolvable provenance SHALL NOT persist. Source deletion SHALL orphan-mark affected edges (preserving audit) rather than silently dropping them.

#### Scenario: Evidence links back to the source
- **WHEN** a user inspects an extracted contradicts edge
- **THEN** at least one citation opens the exact source passage that supports it

### Requirement: Extraction is incremental, budgeted, and correctable
Concept extraction SHALL run change-driven per document with fingerprint staleness, within the AI-links daily budget and battery gates. AI extraction may PROPOSE but never overwrite user-authored or user-edited nodes/edges. Users SHALL be able to rename (alias-preserving), merge, split, and delete graph elements, with merges unioning provenance.

#### Scenario: Re-extraction respects human edits
- **WHEN** a document is re-extracted after the user renamed a concept and locked an edge
- **THEN** the rename persists (old name becomes alias) and the edge is unchanged; conflicts become proposals

#### Scenario: Merge preserves evidence
- **WHEN** two duplicate concepts are merged
- **THEN** all edges re-parent and every evidence citation from both remains queryable

### Requirement: Entity resolution is conservative
Automatic merging SHALL occur only at high confidence (threshold configurable) or via explicit `same-as`; other duplicate candidates SHALL queue for user merge review. Alias normalization and embedding-similarity candidate generation SHALL be deterministic (testable fixtures).

#### Scenario: Low-confidence duplicates wait
- **WHEN** two similarly-named concepts fall below the auto-merge threshold
- **THEN** both remain and a merge suggestion is queued, not auto-applied

### Requirement: Graph queries are budget-bounded
Neighborhood, path, and search queries SHALL execute in SQL with depth/node budgets (no full-graph materialization client- or server-side). Visualization SHALL cap visible nodes (aggregation beyond the cap) and lazy-load on navigation.

#### Scenario: Huge graph stays responsive
- **WHEN** the concept graph exceeds the visible-node cap
- **THEN** rendering shows a bounded, aggregated view and pan/zoom loads regions incrementally without UI stalls

### Requirement: Graph building is local-first; cloud extraction is capability-gated
Local extraction (on-device/BYO) SHALL build the full graph without subscription. Cloud extraction SHALL require `knowledge_graph`, run as quota-bounded jobs, persist nothing server-side beyond job TTL, and honor AI-exclusion flags.

#### Scenario: Excluded document contributes nothing to cloud extraction
- **WHEN** extraction runs with a document flagged exclude-from-cloud
- **THEN** its chunks are absent from cloud job batches (local extraction still allowed)

### Requirement: Graph feeds downstream features
The graph SHALL expose typed relation queries (neighborhood, path, edges-by-type) and `graph-updated` events consumed by gap detection (10) and learning paths (11), with the concept schema owned exclusively by this change.

#### Scenario: Downstream query contract
- **WHEN** proposal 10 queries prerequisite-of edges for a concept neighborhood
- **THEN** results include confidence and provenance without schema knowledge of extraction internals
