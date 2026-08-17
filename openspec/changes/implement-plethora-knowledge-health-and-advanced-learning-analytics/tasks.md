# Implementation Tasks

## 1. Metric engine
- [x] 1.1 `knowledge_health/metrics.rs`: retention/forgetting, stability-trend detection, funnel reconciliation, neglect, growth, reinforcement queries
- [x] 1.2 Algorithm calibration (binning, arena recommendation accuracy) with synthetic-outcome tests
- [x] 1.3 Migration: `knowledge_health_daily` rollups + incremental scheduler (idle/battery) + property test vs recompute

## 2. Contracts & dashboard shell
- [x] 2.2 Analytics shell: Knowledge Health section, navigation, time-range/collection filters, staleness indicator
- [x] 2.2 Mount contracts for gaps (10) and deck health (14) modules
- [x] 2.3 Overview cards, funnel viz, mastery-trend chart (variance bands), workload forecast extension, calibration panel

## 3. Tiering & export
- [x] 3.1 Cloud insights job (`advanced_analytics`, aggregates-only payload assertion, labeling)
- [x] 3.2 `StatisticsExport` extension (JSON/CSV incl. knowledge health)

## 4. Validation
- [x] 4.1 Correctness suite vs fixture ground truth; reconciliation tests; uncertainty gating tests
- [x] 4.2 Dashboard load bench at 100k-item fixture + baselines (protocol); e-ink/mobile snapshots; i18n 6 locales; full gates

