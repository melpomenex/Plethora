## Why

Seven feature changes can each pass bounded tests while the complete Study Plans workflow still fails through navigation seams, restart/lifecycle races, provider/privacy differences, migration history or accessibility/platform gaps. A separate release-qualification change must prove the full user journey and identify unqualified configurations without changing the established behavior contracts.

## What Changes

- Implement the controlled synthetic operating-systems fixture pack, scripted fake providers and deterministic golden native UI/SQLite scenario covering the complete 30-step learning loop and exact expected artifacts/scores/evidence.
- Add layered failure/recovery, source-navigation, offline/privacy/migration/job/mobile and existing Review/FSRS/Queue/Assistant/tutor/card regression evidence.
- Add deterministic performance benchmarks/bases and responsive, keyboard, screen-reader, reduced-motion and accessibility checks.
- Execute a separate named real-provider capability/quality evaluation and physical desktop/mobile platform matrix; mark unexecuted/unqualified workflows explicitly rather than shipping unsupported claims.
- Repair conformance defects through the owning earlier change contract/tasks rather than broadening scope or changing specifications during qualification.

## Capabilities

### New Capabilities

None. This is verification/release readiness only and does not change user-facing requirements.

### Modified Capabilities

None. `.openspec.yaml` sets `skip_specs: true`; defects are corrected against prior owning deltas rather than justified by a new qualification capability.

## Impact

- **Tests/fixtures:** new study-plan golden fixtures under `src/test/`, native fixture helpers, deterministic fake-provider scripts and `src/e2e/` coverage; no production feature behavior added by this change.
- **Verification:** actual command logs, golden normalized DB/UI evidence, provider matrix, platform evidence, accessibility/performance/privacy/migration reports.
- **Program artifacts:** references `07-GOLDEN-SCENARIO.md`, `06-TRACEABILITY-MATRIX.md`, `08-RISK-REGISTER.md` and all earlier change verification files.
- **Performance:** intentional new benchmarks use seeded fixtures and measured `scripts/perf-baselines.json`; no budget/baseline is modified to conceal regression. No paid/live inference in ordinary gates.
