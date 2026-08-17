# Implementation Tasks

## 1. Interface-first (early milestone)
- [x] 1.1 Disclosure registry schema + `isCloudEligible(document)` central helper + CI completeness check
- [x] 1.2 "Local only" flag: document schema/settings UI; migrate 7's AI-exclusion onto it (7 lands as consumer)
- [x] 1.3 Data-map doc generated from registry (docs + in-app privacy center skeleton)

## 2. Deletion & revocation
- [x] 2.1 Server deletion cascade + retention schedule + verification job + deletion receipt
- [x] 2.2 In-app multi-step deletion flow (cloud vs optional local erase) + status/verification
- [x] 2.3 Schema-driven completeness test harness (auto-discovers content-bearing stores)
- [x] 2.4 Device revocation surfacing in privacy center (3's registry)

## 3. Export
- [x] 3.1 Unified versioned `.plethora` archive export (documents/extracts/cards/scheduling/settings) + round-trip fidelity tests
- [x] 3.2 Cloud-held export completeness contract (with 20's job) + per-collection export

## 4. Telemetry, logs, audit
- [x] 4.1 Opt-in telemetry module (default off, counters only, rotating install id) + endpoint + toggle UI
- [x] 4.2 Opt-in crash reporting via log pipeline with content scrubbers + fuzzed-content scan tests
- [x] 4.3 Server audit log (enumerated events, no content) + account-activity view
- [x] 4.4 Secure-log scrubbing rules across cloud clients; `docs/SECURITY.md` secrets inventory/rotation runbook + CI secret scan

## 5. Validation
- [x] 5.1 Enforcement matrix across all registered cloud paths; deletion/export/telemetry suites per spec
- [x] 5.2 i18n 6 locales (privacy center is copy-heavy); full gates

