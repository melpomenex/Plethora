## ADDED Requirements

### Requirement: Metrics are grounded in scheduling truth with documented definitions
Every knowledge-health metric SHALL have a documented definition and derive from existing per-item scheduling state, review records, rollups, or published contracts (mastery estimates, maintenance lineage, graph coverage). No metric SHALL be a meaning-free composite score. Locally-computable metrics SHALL be available to all users.

#### Scenario: Retention derives from retrievability
- **WHEN** the retention metric renders for a library
- **THEN** it equals the documented aggregation of per-item FSRS retrievability with its distribution shown

### Requirement: Uncertainty is respected
Derived metrics SHALL carry confidence representation: distributions or variance bands where meaningful, sample-size gating ("insufficient data" below thresholds), and bounded precision. UI language SHALL avoid certainty claims about knowledge.

#### Scenario: Small samples gate
- **WHEN** a topic has fewer than the threshold of reviewable items
- **THEN** its mastery trend renders an insufficient-data state instead of a number

### Requirement: Rollups power rendering without full scans
Dashboard reads SHALL come from incrementally maintained rollup tables (`knowledge_health_daily`) refreshed by the idle scheduler; no render-time full-library scans (query-plan assertion on fixture data). Staleness SHALL be visible when rollups lag.

#### Scenario: Rollup equals recompute
- **WHEN** incremental rollup maintenance is compared to a full recompute in a property test
- **THEN** values match exactly

### Requirement: Conversion funnel reconciles exactly
Reading-to-retention conversion (imported/read → extracted → carded → reviewed → retained) SHALL reconcile exactly with table counts for any selected scope/window, and the consumed-but-never-converted list SHALL be enumerable.

#### Scenario: Funnel reconciles
- **WHEN** funnel counts are cross-checked against direct SQL counts in tests
- **THEN** they match for every stage and filter combination

### Requirement: Algorithm performance is measurable
Per-algorithm/per-model calibration (predicted vs actual recall in bins, arena recommendation accuracy from `review_results` + arena data) SHALL be computed and displayed with honesty labels (Beta where appropriate).

#### Scenario: Calibration reflects outcomes
- **WHEN** synthetic reviews deviate systematically from a model's predictions
- **THEN** that model's calibration panel shows the degradation

### Requirement: Cloud intelligence is aggregate-only and capability-gated
Model-generated longitudinal insights SHALL require `advanced_analytics`, receive only metric aggregates (never raw document/extract content), with disclosed data flow; every such insight SHALL be labeled as generated.

#### Scenario: Insights see aggregates only
- **WHEN** a cloud insight job runs
- **THEN** its payload contains metric aggregates and no document text

### Requirement: Accessibility across modes
All charts SHALL provide e-ink text-first fallbacks (tables) and mobile layouts; filters (time range, collection) SHALL apply across the dashboard; export SHALL include knowledge-health data.

#### Scenario: E-ink fallback renders
- **WHEN** e-ink mode is active
- **THEN** every knowledge-health visualization renders a readable table variant
