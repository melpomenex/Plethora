# Change: Implement Plethora Knowledge Health and Advanced Learning Analytics

> Wave 2 — Intelligence (parallel with 12/14; consumes signals from 7/9/10/14). Capability: `advanced_analytics` gates only the *cloud-computed* longitudinal intelligence; all locally-computable analytics are Free.

## Why

Existing stats measure activity (reviews/day, streaks). Knowledge health measures *learning*: estimated retention, predicted forgetting, weak concepts, neglected topics, reading-to-retention conversion, cards becoming unstable, concept reinforcement, knowledge growth, review workload, algorithm performance, consumed-but-never-converted items, topic-level mastery trends — with uncertainty respected. Metrics must build on the scheduling data the app already owns, not invent meaning-free scores.

## What exists today
- **Activity analytics** (recharts): `src/components/analytics/` — ActivityChart, CategoryBreakdown, ForecastSimulator, ForgettingCurvePanel, ProgressRings, ReviewHeatmap (12-month), ScheduleVisualization, StudyStreak, WorkloadCalendar (+day popover), StatisticsExport; `analyticsStore`; `study_statistics` daily rollups; per-item `ItemStatsModal`; review-side `MemoryHorizon`, `FSRSInspector`.
- **Scheduling truth**: per-item FSRS stability/difficulty/retrievability (`QueueItem` projections), review_results with ratings/times, Plethora Precision arena weights and per-model recommendations, postpone history, `item_stats_repository`.
- **Signals from new stack**: mastery estimates + gaps (10), card version lineage + maintenance findings (14), concept graph coverage (9), reading-to-extract conversion (`extract_count`, passage scores), lesson outcomes (12's `lesson-completed`).
- Bench precedent: `semanticGrading.bench.ts`, analytics-adjacent tests; export = `StatisticsExport`.

## What Changes

### 1. Metric engine (`src-tauri/src/knowledge_health/metrics.rs` — file-disjoint from 10's `gaps.rs` per shared-namespace agreement)
Locally-computable metrics (Free), each with definition, source queries, and uncertainty treatment:
- **Retention & forgetting**: estimated retention = mean retrievability over active items (FSRS R(t) per item, aggregated with distribution not just mean); predicted forgetting curve next 7/30 days; "cards becoming unstable" (stability trend negative across k reviews).
- **Conversion funnel**: imported/read → extracted → carded → reviewed → retained per collection/topic/time-window; "consumed but never converted" list (feeds 10's read_never_reviewed).
- **Workload & forecast**: upcoming workload (exists — extended with stability-weighted effort), overload risk, postpone impact accounting (existing engine data).
- **Algorithm performance**: FSRS vs Plethora Precision arena per-model calibration (predicted vs actual recall, Brier-style bins — data already in `review_results` + arena recommendations), per-algorithm recommendation accuracy.
- **Topic/concept mastery trends**: from 10's estimates over time (time series, variance bands).
- **Knowledge growth**: new concepts/sources/cards per period, reinforcement counts (repeat exposures from 8's accepted connections).
- **Neglect detection**: topics untouched vs due-weighted expectation.
Cloud-computed longitudinal intelligence (`advanced_analytics` capability): cross-period pattern summaries, personalized insights text (model-generated over metric aggregates only — never raw content), benchmark-style personal trends. Aggregates-only payloads, disclosed.

### 2. Honest uncertainty
Every derived metric carries a confidence representation: distribution/band where meaningful (retention histograms, variance bands on mastery trends), sample-size gating (n < threshold renders "insufficient data" instead of a scary number), and no false-precision (percentages bounded, smoothing documented). Copy reviewed to avoid certainty language.

### 3. UX — Knowledge Health dashboard
- New top-level Analytics section (shell owned here; gaps module 10 mounts within): overview cards (retention estimate w/ distribution, conversion funnel viz, workload forecast), concept-mastery trend chart, weak/neglected topics table (deep-links to 10 gaps and 9 graph), deck health summary (14 findings), algorithm calibration panel (per-model reliability).
- Time-range + collection filters everywhere (existing DateRangePicker reuse); e-ink text-first fallbacks for every chart (tables); mobile stacked layouts (existing responsive patterns).
- Export extension: `StatisticsExport` gains knowledge-health JSON/CSV.

### 4. Performance
- Metric queries SQL-aggregated (rollup tables extended additively: `knowledge_health_daily {date, collection, metric bundle}` maintained incrementally by the idle scheduler — no on-render full scans); render-time reads from rollups only; heavy windows computed async with staleness shown.

## Impact

### Affected Specs
- `knowledge-health-analytics` — New (metric definitions, uncertainty rules, rollup architecture, cloud tier boundary, dashboard requirements).

### Affected Code Areas
- New `knowledge_health/metrics.rs` + rollup scheduler; migration (rollup table); `src/components/analytics/knowledgeHealth/*`; AnalyticsPage section shell; `StatisticsExport` extension; i18n.

### Non-goals
- No gamification/leaderboards, no cross-user comparisons or anonymized benchmarks (v1), no new scheduling behavior, no gap detection logic (10 owns), no deck maintenance logic (14 owns).

## Dependencies

### Hard dependencies
- 10 (mastery estimates + shared namespace), 2 (capability gate for cloud tier). Soft: 9 (concept aggregation), 14 (deck-health inputs), 12 (lesson outcomes), 8 (reinforcement counts).

### May run concurrently
- 12, 14 (contract-separated); 11 late (path progress consumed as a metric).

### Must not start yet
- —.

## Shared interfaces
- `knowledge_health_daily` rollup schema + query commands; metric definitions doc (single source of truth for all surfaces); gaps/deck-health mount contracts inside the Analytics shell (10/14 render their modules; this change owns shell + navigation).

## Ownership boundaries
- **May modify**: analytics components/shell (additive sections), rollups/migrations, StatisticsExport.
- **Must treat as external**: scheduling internals (read-only), 10's gap logic, 14's findings logic, graph queries.

## Collision risks
- `AnalyticsPage.tsx`/`AnalyticsTab` mounts (10/14 also mount — this change lands the shell first or coordinates order); `analyticsStore` (extend additively); migration numbering.

## Integration contract
- Reads published contracts: `list_gaps` (10), maintenance lineage queries (14), mastery estimates (10), graph coverage counts (9), `lesson-completed` events (12), path progress (11). Provides rollup query API used by dashboard + export.

## Testing & acceptance

### Tests
- Metric correctness: synthetic fixture libraries with known ground truth (seeded PRNG) — retention aggregation matches per-item R(t) math; funnel counts reconcile with table counts exactly; calibration bins correct vs synthetic outcomes.
- Uncertainty rules: small-n gating triggers; bands render; no metric renders without its sample size.
- Rollups: incremental maintenance equals full recompute (property test); staleness surfaced; no on-render scans (query-plan assertions on fixture DB).
- Export round-trip; e-ink/mobile fallback snapshots.
- Performance: dashboard load p95 at 100k-item fixture within budget (bench + baselines per AGENTS.md).

### Acceptance criteria
- Knowledge Health dashboard renders retention/funnel/workload/calibration/mastery-trends with honest uncertainty from a fixture library; gaps + deck health mount in-shell; exports work; Free tier gets all locally-computable metrics; cloud tier gates with reason.

### Must remain unchanged
- Existing analytics components' correctness; review/scheduling behavior; existing benches (or baselines updated per protocol).

## Open questions
1. Retention aggregation default (mean vs median vs histogram-first) — ship histogram + mean, settings choice.
2. Rollup retention window (daily vs hourly granularity).
3. Whether algorithm-calibration panel ships Beta-labeled (default yes, honest).
