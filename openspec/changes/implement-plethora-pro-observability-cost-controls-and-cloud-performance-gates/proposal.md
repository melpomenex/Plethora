# Change: Implement Plethora Pro Observability, Cost Controls, and Cloud Performance Gates

> Wave 1→4 — spans the cloud stack (emission points defined with 5; dashboards/alerts/thresholds hardening before any paid cloud service is declared production-ready). No user-facing feature UI beyond an internal ops surface.

## Why

A commercial cloud product must know — continuously and cheaply — its latency, job durations, provider costs per capability, storage/bandwidth growth, per-user usage distributions, rate-limit/abuse patterns, failure/retry rates, queue depth, provider/model health, and quota-exhaustion frequency; and it must **enforce** cost ceilings (already structural in 5) with automated alerting. The repo's existing perf-gate philosophy (baselines, tolerances, anchor-normalized costs, CI enforcement in `ci-regression.yml` + `AGENTS.md`) extends to the cloud service. Absolute rule: **no private document content in observability data** — ids, classes, durations, costs only.

## What exists today
- **App-side gates (strong precedent)**: `scripts/perf-baselines.json` (20 baselines, anchor-normalized costs, tolerances), `check-perf-budget.mjs` (median-calibrated, fail/warn semantics), `check-bundle-budget.mjs`, memory-bench system + `check-memory-budget.mjs`, CI jobs (performance blocking, memory non-blocking, visual warn-only) — the philosophy to replicate server-side.
- **Server**: structured request-id logging points defined by 5; `usage_records` with `cost_usd_micros`; quota/kill-switch emission points; health endpoint only.
- **Client**: task-engine diagnostics (`diagnostics.ts`, privacy-sanitized), AI provenance; Vercel analytics (web only).
- **Nothing exists** for: metrics storage, dashboards, alerting, load-test baselines, provider health tracking, SLOs.

## What Changes

### 1. Metrics pipeline (server)
- Emission (from 5's points) into a metrics store (Prometheus-compatible exposition at minimum; scrape-based so the storage backend is swappable — matches provider-abstraction philosophy): counters/histograms for requests (route, status, latency), jobs (kind, queue-wait, duration, attempts, outcome), provider calls (vendor, model, latency, tokens, cost), storage/bandwidth bytes, rate-limit events (keyed class), quota exhaustions (capability), auth events (class), webhook deliveries (outcome, attempts), sync push/pull (records, bytes, latency — sizes only).
- **Content-free by construction**: label allowlist (no user content, no document ids in high-cardinality labels — account ids only in privately-accessible per-account views, hashed in general metrics); log scrubbers verified by scans (extends 22).

### 2. Dashboards & alerting
- Ops dashboards (Grafana-compatible JSON in-repo or equivalent): service health, latency percentiles, job queues, provider health/cost, quota/abuse, sync health.
- **Alert rules with thresholds** (documented defaults): error-rate, p95 latency, queue depth/age, provider circuit state, daily aggregate cost vs budget, kill-switch trips, disk/bandwidth growth, cert/secret expiry soon (ties 22's inventory).
- On-call-ready runbook (`docs/OPS_RUNBOOK.md`): symptom → dashboard → likely cause → action (incl. kill-switch operation, provider rerouting, scale knobs).

### 3. Per-user usage & cost accounting (visible)
- Aggregates from `usage_records`: per-account per-capability usage/cost views (private), cohort distributions (anonymized histograms for planning), quota-exhaustion frequency (product signal for envelope tuning — feeds pricing decisions without content).
- Fraud/abuse signals: impossible-usage rates, coordinated key abuse patterns, webhook hammering — events into the abuse queue (5) with review tooling.

### 4. Cloud performance gates (extend the repo's gate philosophy)
- **Load-test baselines**: CI job (on demand + nightly) running scripted load (k6 or node driver) against the staged service with a service-side `perf-baselines` file (`cloud/baselines.json` or `scripts/cloud-perf-baselines.json`) using the same tolerance/anchor philosophy: p95 latency per route class, job throughput per kind, sync records/sec. Regressions fail CI (after initial baseline recording from a reference run, mirroring the app gate's warn→enforce rollout).
- **Cost tests**: pricing-config tests (unit costs × fixture volumes → expected `cost_usd_micros` ranges) so provider pricing changes can't silently break ceilings; nightly budget simulation.
- **SLO definitions**: documented (availability, latency, job-completion) with error-budget tracking posture (v1: measurement, not enforcement).

### 5. Crash & error reporting (server)
- Error tracking with grouping (route/job/provider), stack traces scrubbed of content; integration points for an error service behind abstraction (Sentry-compatible API shape, self-hostable choice at deployment); alerts into the same rule system.

## Impact

### Affected Specs
- `cloud-observability` — New (metrics contract, content-freedom invariants, alert thresholds, load-gate baselines, cost tests, runbook).

### Affected Code Areas
- Server metrics middleware/registry, dashboards/alert rules (in-repo definitions), load-test harness + baselines file, cost-test fixtures, ops docs; CI workflow addition (`ci-regression.yml` or a sibling cloud job); no app changes (client diagnostics unchanged).

### Non-goals
- No user-facing analytics, no tracing of document content (hard rule), no multi-region monitoring, no charging logic (5/4 own), no client-side RUM beyond existing web analytics posture (22 owns policy).

## Dependencies

### Hard dependencies
- 5 (emission points, usage records, kill switches). Soft: every cloud proposal (their kinds/providers appear as label dimensions automatically).

### May run concurrently
- Everything after 5's framework lands (this change hardens alongside 6/16–20 rather than after).

### Must not start yet
- Enforcing cloud perf gates before baselines exist from reference runs (warn-only first — same rollout as the app gate).

## Shared interfaces
- Metric naming/label conventions + allowlist; `cloud-perf-baselines.json` schema (mirrors `perf-baselines.json` semantics incl. tolerances); alert-rule definitions; cost-test fixture format; runbook structure.

## Ownership boundaries
- **May modify**: server observability modules, CI cloud jobs, baselines/alert/dashboards, ops docs.
- **Must treat as external**: job/quota/kill-switch mechanics (5 — consumes their events), provider registry internals (reads health state).

## Collision risks
- `server/src/index.ts` middleware order (5 owns; this adds the metrics layer insertion point agreed there); CI workflow files (additive job).

## Integration contract
- 5's emission points are the only producers; new job kinds (16–20) get metrics without changes by registering kinds (label dimension from the registry); alert webhooks feed the ops channel configured at deployment.

## Testing & acceptance

### Tests
- Content-freedom: fuzzed payloads with document-like strings through every instrumented path → metric/log label scans find nothing (extends 22's scanners).
- Cardinality guards: label allowlist enforcement (unknown labels rejected in tests) to prevent unbounded series.
- Alert rules: threshold unit tests against synthetic metric streams (fires/doesn't-fire cases per rule).
- Load gate: baseline-recording run; regression detection (inject latency → gate fails); tolerance behavior mirrors `check-perf-budget.mjs` semantics; median-calibration across runner classes where applicable.
- Cost tests: fixture volumes × pricing config → expected ranges; pricing-config change → test surfaces delta.
- Error-reporting scrubbers (content/secret patterns).

### Acceptance criteria
- Staged service exposes a complete, documented metric surface with dashboards rendering real traffic; alert rules fire on injected fault scenarios; nightly load job compares against committed baselines and fails on regression (post-baseline); nightly cost simulation reports budget posture; runbook walks the top-10 failure scenarios; zero content in any observability store (verified).

### Must remain unchanged
- App-side perf gates and baselines (independent); app performance (no client changes); existing CI jobs (additive sibling).

## Open questions
1. Metrics backend choice (self-hosted Prometheus vs managed) — deployment decision; definitions stay backend-agnostic.
2. Nightly vs per-PR load testing cadence (start nightly; per-PR on service-dir changes).
3. Error-service selection (Sentry-compatible abstraction assumed).
