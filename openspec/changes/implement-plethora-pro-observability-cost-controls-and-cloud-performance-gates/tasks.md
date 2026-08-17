# Implementation Tasks

## 1. Metrics pipeline
- [ ] 1.1 Metrics middleware/registry (Prometheus exposition) wired into 5's emission points; label allowlist + cardinality guards
- [ ] 1.2 Log/error scrubber extension + fuzzed-content scan tests
- [ ] 1.3 Error tracking with grouping behind an abstract service; stack scrubbing

## 2. Dashboards, alerts, runbook
- [ ] 2.1 Dashboard definitions (service, jobs, providers/cost, quota/abuse, sync) in-repo
- [ ] 2.2 Alert rules with thresholds + synthetic-stream unit tests; notification channel config
- [ ] 2.3 `docs/OPS_RUNBOOK.md` (top failure scenarios → actions incl. kill switches)

## 3. Gates & cost tests
- [ ] 3.1 CI load-test job (k6/node driver) + `cloud-perf-baselines.json` with tolerance semantics mirroring the app gate
- [ ] 3.2 Baseline recording from reference runs; warn-only → enforcing rollout documented
- [ ] 3.3 Cost fixtures vs pricing config + nightly budget simulation + ceiling event reporting

## 4. Usage views & abuse
- [ ] 4.1 Per-account usage/cost views (access-controlled) + anonymized cohort histograms + quota-exhaustion reporting
- [ ] 4.2 Abuse signal detection into 5's abuse queue + review tooling

## 5. Validation
- [ ] 5.1 Content-freedom suites across all instrumented paths; alert/gate/cost test suites green
- [ ] 5.2 Staged-environment soak with dashboards populated; runbook walkthrough record
