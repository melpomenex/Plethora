## Context

The repo has two partial performance guards and no real gate:

- `scripts/check-bundle-budget.mjs` + `scripts/bundle-budgets.json` — a working, well-shaped size gate (committed budgets, deliberate updates, non-zero exit). This is the pattern to copy.
- `src/utils/__tests__/wave5Performance.test.ts` and `src/utils/__tests__/performance.test.tsx` — wall-clock assertions with absolute thresholds set so loosely (`expect(duration).toBeLessThan(4000)` around ~50ms of work) that they catch nothing. They are run by `npm run test:wave5:performance` but function as smoke tests, not regression gates.
- `.github/workflows/ci-regression.yml` already gates `main` on tsc, Rust tests, and a bundle-size step (which only emits `::warning::`, never fails).

So today a PR can make queue building 3× slower and CI stays green. The gap is not "we have no timing code" — it is that nothing compares against a recorded baseline and nothing fails.

Constraints:

- Runners are shared GitHub `ubuntu-latest` VMs. Raw wall-clock ms varies 2–3× between runs on identical code; a naive ms threshold is either so loose it catches nothing (today's problem) or so tight it flakes.
- Vitest 4.0.18 is already installed and ships `vitest bench` (Tinybench) with `--outputJson` and `--compare`. No new dependency is needed.
- The hot paths worth measuring are mostly pure TypeScript (`src/lib/precisionScheduler.ts`, `src/lib/postpone.ts`, queue assembly, markdown/import parsing) and are already unit-testable without a Tauri runtime.

## Goals / Non-Goals

**Goals:**

- One command (`npm run bench:check`) answers "is this branch slower than the recorded baseline?" with a non-zero exit code.
- Measurements comparable across machines and runner classes, so a developer's local run and CI agree on pass/fail.
- Adding a new benchmark is a ~10-line drop-in, so coverage grows as hot paths are found.
- Baselines are committed, human-readable, and updated deliberately in the same PR that changes performance — identical to the `bundle-budgets.json` protocol already in use.
- The gate blocks both PR merges and release builds.

**Non-Goals:**

- Rust `src-tauri` benchmarks. Would require adding `criterion` as a dev-dependency and a second gate pipeline. Deferred until a Rust hot path is actually implicated.
- End-to-end app startup / frame-rate timing. Requires driving a built Tauri app in CI; high cost, high flake, low signal at this stage.
- Historical trend dashboards or a hosted results service. A committed baseline file is enough to gate; trend graphs are a want, not a gate.
- Memory/allocation profiling. Separate axis, separate tooling.

## Decisions

### 1. `vitest bench` over a dedicated benchmark tool

**Chosen**: Vitest's built-in `bench` mode (Tinybench under the hood).

Already installed, shares the existing `resolve.alias` and plugin setup, and benchmark files sit next to the code they measure (`*.bench.ts`). Tinybench handles warmup, iteration counts, and reports hz/mean/p99 — all the statistics work is done.

**Alternatives considered**: `benchmark.js` (unmaintained, new dep), `tinybench` directly (same engine, but we'd re-implement discovery and reporting), `hyperfine` (process-level only — wrong granularity for in-process hot paths).

### 2. Normalize against an in-process noise anchor — the core decision

Raw milliseconds are not portable. Instead, every benchmark run includes one fixed **anchor** benchmark: a deterministic, allocation-light synthetic workload (integer + string mixing loop) whose cost is a proxy for "how fast is this machine right now".

The gate compares a dimensionless **cost ratio**:

```
cost = anchorHz / benchHz     // "this benchmark costs N anchor-operations"
```

A runner that is 2× slower makes both `anchorHz` and `benchHz` 2× smaller, so `cost` is unchanged. A genuine regression slows only `benchHz`, so `cost` rises. Baselines record `cost`, not milliseconds.

This is what makes a tight tolerance (default 1.25×) survivable on shared CI runners, and it is why the gate can run on a developer laptop and give the same verdict.

**Alternatives considered**: absolute ms thresholds (today's failure mode — must be set 50× loose to avoid flakes); self-hosted dedicated runners (real fix for noise, but ops cost and a hardware dependency for a hobby-scale release gate); "run 5× and take the median" (reduces variance within a runner class but does nothing about the runner class *changing*, which is the actual problem); comparing against a baseline measured in the same CI job by checking out `main` and benching it too (most accurate, but doubles CI time and needs a clean second checkout — keep as the escalation path if anchor normalization proves insufficient).

The anchor is not a perfect model of the machine: it does not capture cache size, GC pressure, or IO. It is a first-order correction, and the tolerance absorbs the rest.

### 3. Baseline file mirrors `bundle-budgets.json`

`scripts/perf-baselines.json`:

```json
{
  "_comment": "Recorded cost ratios (anchorHz / benchHz). Update deliberately, in the same PR as an intentional perf change, and say why in the PR description.",
  "defaultTolerance": 1.25,
  "anchor": { "name": "noise-anchor", "iterations": 200000 },
  "benchmarks": {
    "precision/next-interval": { "cost": 12.4, "tolerance": 1.25 },
    "postpone/plan-1000-items": { "cost": 840.0 },
    "queue/build-500-items": { "cost": 1310.0 }
  }
}
```

Rules: an unknown benchmark name is a **warning** (new bench, not yet baselined — the run prints the line to paste in); a missing baseline for a benchmark that *was* baselined is a **failure** (someone deleted coverage); exceeding `cost × tolerance` is a **failure**; coming in more than 25% *faster* than baseline is a **warning** telling the author to re-record, so baselines don't rot into permanently-loose ceilings.

### 4. A separate `vitest.bench.config.ts` with `environment: "node"`

The main `vitest.config.ts` uses `environment: "jsdom"` and loads `src/test/setup.ts`. jsdom adds startup cost and unpredictable timing to benchmarks. The bench config reuses the same `resolve.alias` but runs in `node` with `pool: "forks"`, `fileParallelism: false`, and `isolate: true` — one benchmark file at a time, so suites do not contend for CPU with each other.

`fileParallelism: false` is what makes results reproducible; it also means the bench job's wall-clock grows linearly with suite count. That is the trade, and it is why the seed set is small.

### 5. Gate script owns pass/fail, not `vitest --compare`

`vitest bench --compare` prints a comparison table but always exits 0. So: `vitest bench --outputJson=.bench/results.json`, then `scripts/check-perf-budget.mjs` reads that JSON, computes ratios against the anchor, compares to `perf-baselines.json`, prints a table, and exits 1 on any failure. Same shape and same exit-code contract as `check-bundle-budget.mjs`, so the two compose into one `bench:check` script.

### 6. Seed benchmark set

Start with the paths where a regression is felt by a user in a loop, not the paths that are merely slow once:

| Suite | Why |
|---|---|
| `src/lib/precision.bench.ts` | Scheduler math runs per grade, per item — the tightest loop in the app |
| `src/lib/postpone.bench.ts` | Postpone plans over the whole collection; already has three specs |
| `src/pages/queueScrollBudget.bench.ts` | Queue assembly gates time-to-first-item |
| `src/utils/markdown.bench.ts` | Runs on every reader render |
| `src/utils/ankiImport.bench.ts` | Bulk import throughput; user-visible on large decks |
| `src/lib/file-manifest.bench.ts` | Sync path; `yjs-sync-performance` spec already exists |

Benchmarks use fixed synthetic inputs generated by a seeded PRNG (no `Math.random()`, no `Date.now()`) so run-to-run input size and shape are identical.

### 7. CI wiring

A `performance` job in `.github/workflows/ci-regression.yml`, `needs: test`, running in parallel with `bundle-size`. Node only — no Rust toolchain, no system deps, so it stays cheap. It runs on PRs and on `main`. Release builds inherit the gate because `release.yml` requires a green `main`.

The existing `bundle-size` step that only emits `::warning::` is left alone; `npm run bench:check` invokes `check-bundle-budget.mjs` too, so the real enforcement lives in one place.

## Risks / Trade-offs

- **Anchor normalization is imperfect — a bench dominated by memory bandwidth or GC will not track a CPU-bound anchor** → tolerance is per-benchmark and overridable; a bench that proves noisy in practice gets a wider tolerance recorded next to it with a comment, or gets dropped. If flakes persist across several benches, escalate to the "bench `main` in the same job" approach named in Decision 2.
- **Baseline rot: authors bump the number instead of investigating** → the >25%-faster warning catches loosening in one direction, and the baseline file is small enough that a diff touching it is visible in review. This is a social control, not a technical one, and it is the same control the bundle budget already relies on.
- **Benchmarks measure synthetic inputs, not real user data** → seed inputs are sized from realistic collections (hundreds to low thousands of items). A pass here is not proof the app is fast; it is proof this branch is not *slower* than the last, which is what a release gate needs.
- **Bench job adds CI wall-clock** (~2–4 min with `fileParallelism: false`) → runs in parallel with `bundle-size`, and the seed set is deliberately six suites, not sixty.
- **First-run baselines are recorded on whatever machine records them** → baselines MUST be recorded from a CI run on `main`, not from a laptop, and the file records which run produced them. Anchor normalization makes this less critical but not irrelevant.
- **Removing the loose assertions from `wave5Performance.test.ts` briefly removes a (weak) check** → the replacing benches land in the same PR, so there is no window without coverage.

## Migration Plan

1. Land the harness, config, gate script, and seed benches with the gate in **warn-only** mode (`--warn-only` flag, exit 0).
2. Merge to `main`, let CI run, record the resulting costs into `perf-baselines.json` from that run's output.
3. Flip the gate to enforcing in a follow-up commit.
4. Rollback: the gate is one CI job and one script; deleting the `performance` job from the workflow disables it without touching app code.

## Open Questions

- Should the gate also run on release tags as a belt-and-braces check, or is "green `main`" sufficient? (Leaning sufficient — `release.yml` already builds from `main`.)
- Is 1.25× the right default tolerance, or should it be set from observed variance after a week of `main` runs? (Recording the first ~10 `main` runs before flipping to enforcing would answer this empirically; step 2 of the migration plan is the natural place.)
