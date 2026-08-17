# Implementation Tasks

## 1. Signals & mastery
- [ ] 1.1 `knowledge_health/gaps.rs`: signal queries (review histories, coverage, assessments, activity)
- [ ] 1.2 Mastery estimator (Bayesian blend + variance) with unit tests (monotonicity, decay)
- [ ] 1.3 Incremental scheduler (idle/battery gates, change signals, staleness cache)

## 2. Detection rules
- [ ] 2.1 Implement six gap kinds with documented rules + seeded-fixture tests per kind
- [ ] 2.2 Evidence assembly (citation-backed records) + suppression store + re-evaluation triggers
- [ ] 2.3 Cloud model-assisted analysis job (evidence summaries only, capability, quota, exclusion)

## 3. UX & actions
- [ ] 3.1 Gaps module UI (Analytics section + standalone view): probabilistic copy, evidence inspector, suppress
- [ ] 3.2 Action routing: Teach me (12), Find material (library + Brave/arXiv), practice/cards (13), e-ink text variant
- [ ] 3.3 Post-session summary line (≤1/session) + interruption guard tests
- [ ] 3.4 `gaps-updated` event; contract note for 11/15

## 4. Validation
- [ ] 4.1 Full fixture E2E (weak TLB scenario end-to-end)
- [ ] 4.2 Detection p95 bench + baseline (protocol); i18n 6 locales; full gates
