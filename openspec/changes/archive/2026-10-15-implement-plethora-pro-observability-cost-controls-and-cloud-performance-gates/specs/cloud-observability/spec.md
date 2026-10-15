## ADDED Requirements

### Requirement: Metrics cover the operational surface
The service SHALL emit metrics for requests (route class, status, latency), jobs (kind, queue wait, duration, attempts, outcome), provider calls (vendor, model class, latency, tokens, cost), storage and bandwidth bytes, rate-limit events, quota exhaustions per capability, auth event classes, webhook delivery outcomes, and sync push/pull volumes (records/bytes/latency). New job kinds SHALL appear automatically via registry label dimensions without observability changes.

#### Scenario: New kind is visible without changes
- **WHEN** a proposal registers a new job kind and traffic flows
- **THEN** its queue/latency/outcome metrics render on existing dashboards

### Requirement: Observability data is content-free
Metrics labels SHALL come from an enforced allowlist (no user content, no titles/URLs; high-cardinality values prohibited in general metrics; account identifiers only in access-controlled per-account views, hashed elsewhere). Logs and error reports SHALL pass the same scrubbers. Fuzzed-content tests SHALL verify no leakage through any instrumented path.

#### Scenario: Fuzzed content never leaks
- **WHEN** fuzzed payloads containing document-like strings traverse instrumented paths
- **THEN** metric labels, log lines, and error reports contain none of it

### Requirement: Alerting has documented thresholds and a runbook
Alert rules SHALL exist with default thresholds for error rate, p95 latency, queue depth/age, provider circuit state, aggregate daily cost vs budget, kill-switch trips, storage/bandwidth growth, and secret-expiry proximity. A runbook SHALL map each alert to diagnosis steps and remediations (kill-switch operation, provider rerouting, scaling). Rules SHALL have threshold unit tests against synthetic streams.

#### Scenario: Injected latency fires the right alert
- **WHEN** a synthetic stream exceeds the p95 threshold
- **THEN** the corresponding alert fires and no unrelated alerts do

### Requirement: Cloud performance gates mirror the app gate philosophy
A CI load-test job SHALL compare service p95 latency per route class, job throughput per kind, and sync throughput against a committed baselines file using tolerance-based, runner-calibrated semantics equivalent to `scripts/check-perf-baselines.json` handling. Gates SHALL be warn-only until baselines are recorded from reference runs, then enforcing. Intentional changes SHALL update baselines in the same change with stated reason.

#### Scenario: Regression fails the gate
- **WHEN** a service change induces p95 latency beyond baseline × tolerance
- **THEN** the cloud gate fails CI with the offending metric identified

#### Scenario: Baseline update protocol
- **WHEN** an intentional performance-affecting change lands
- **THEN** the same change updates the cloud baselines file with a documented reason

### Requirement: Cost accounting is testable and budget-simulated
Unit-cost fixtures SHALL verify `cost_usd_micros` computation per provider/model against pricing config (config changes surface as test deltas), and a nightly budget simulation SHALL project aggregate spend against configured ceilings and report posture. Kill-switch and ceiling behavior SHALL be observable as events.

#### Scenario: Pricing change caught
- **WHEN** a provider pricing field changes
- **THEN** cost tests report the affected capabilities and expected budget impact

### Requirement: Per-user usage views support planning without exposure
Per-account usage/cost views SHALL be access-controlled; cohort distributions SHALL be anonymized histograms; quota-exhaustion frequency SHALL be reportable per capability as a product signal without any content association.

#### Scenario: Cohort view is anonymized
- **WHEN** usage distributions are rendered for planning
- **THEN** no account is identifiable and no content is associated
