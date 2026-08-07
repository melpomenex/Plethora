## Why

Performance regressions currently ship undetected: the only automated size/speed check is `scripts/check-bundle-budget.mjs` (bundle bytes only), and the ad-hoc timing assertions in `src/utils/__tests__/wave5Performance.test.ts` use absolute wall-clock thresholds so loose (`< 4000ms` for work that takes ~50ms) that a 50× slowdown passes. Nothing measures the hot paths users actually feel — queue building, scheduler math, search, parsing — so a release can ship 3× slower with a green CI.

## What Changes

- Add a **benchmark harness** built on `vitest bench` (already installed — no new dependency) covering the hot paths that gate perceived app speed.
- Add a **noise anchor** benchmark that runs in the same process as every suite, so the gate compares *ratios* (bench ÷ anchor) instead of raw milliseconds. This makes results portable across CI runner classes and developer machines.
- Add **committed baselines** (`scripts/perf-baselines.json`) following the existing `bundle-budgets.json` convention: recorded actuals plus explicit tolerance, updated deliberately in the same PR as an intentional change.
- Add a **comparison gate** (`scripts/check-perf-budget.mjs`) that reads the bench JSON output, normalizes by the anchor, and exits non-zero when any benchmark exceeds its baseline ratio by more than its tolerance.
- Wire `npm run bench` and `npm run bench:check` and add a `performance` job to `.github/workflows/ci-regression.yml`, so both PRs and release builds are gated.
- Fold the existing bundle-size check into the same gate report so one command answers "is this release slower or fatter than the last one?"
- Replace the misleading absolute-threshold assertions in `wave5Performance.test.ts` with real benchmarks under the harness.

## Capabilities

### New Capabilities

- `performance-benchmark-gate`: Defines the benchmark harness, how measurements are normalized and made comparable across machines, the baseline file format and update protocol, the pass/fail rules that gate CI and releases, and the reporting shown on failure.

### Modified Capabilities

<!-- None. The bundle-size script is existing tooling with no spec of its own; it is
     consumed by the new gate rather than having its requirements changed. -->

## Impact

- **New files**: `src/**/*.bench.ts` benchmark suites, `scripts/check-perf-budget.mjs`, `scripts/perf-baselines.json`, `vitest.bench.config.ts`.
- **Modified**: `package.json` (scripts), `.github/workflows/ci-regression.yml` (new gated job), `src/utils/__tests__/wave5Performance.test.ts` (timing assertions removed, replaced by benches).
- **Dependencies**: none added — `vitest bench` (Tinybench) ships with the installed Vitest.
- **Developer workflow**: an intentional performance change now requires updating `perf-baselines.json` in the same PR, mirroring how bundle growth requires updating `bundle-budgets.json`.
- **Out of scope (deferred)**: Rust-side benchmarks for `src-tauri` (would need a new `criterion` dev-dependency), and full end-to-end app startup timing (needs a driven Tauri build in CI). Both are noted as follow-ups in design.md, not built here.
