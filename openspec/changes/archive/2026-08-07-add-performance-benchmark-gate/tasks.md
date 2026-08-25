## 1. Harness scaffolding

- [x] 1.1 Create `vitest.bench.config.ts`: reuse the `@` → `./src` alias from `vitest.config.ts`, set `environment: "node"`, `benchmark.include: ["src/**/*.bench.ts"]`, `pool: "forks"`, `fileParallelism: false`, `isolate: true`, and no jsdom setup file.
- [x] 1.2 Add `"src/**/*.bench.ts"` to the `exclude` list in `vitest.config.ts` so `npm test` never picks up benchmark files.
- [x] 1.3 Add npm scripts: `"bench": "vitest bench --run --config vitest.bench.config.ts --outputJson=.bench/results.json"` and `"bench:check": "npm run bench && node scripts/check-perf-budget.mjs && node scripts/check-bundle-budget.mjs"`.
- [x] 1.4 Add `.bench/` to `.gitignore`.
- [x] 1.5 Verify `npm run bench` exits 0 and writes `.bench/results.json` with zero benchmark files present (`--passWithNoTests` if needed).

## 2. Noise anchor and shared benchmark helpers

- [x] 2.1 Create `src/test/bench-support.ts` exporting `seededRandom(seed)` — a small deterministic PRNG (mulberry32 or equivalent) — for building benchmark inputs without `Math.random()`.
- [x] 2.2 Add `runAnchor()` to `src/test/bench-support.ts`: a deterministic integer + string mixing loop of a fixed iteration count, with a `return` value consumed so the engine cannot optimize it away.
- [x] 2.3 Create `src/anchor.bench.ts` that benchmarks `runAnchor()` under the exact name `noise-anchor`, and document that it must be present in every run.
- [x] 2.4 Run `npm run bench` three times and confirm `noise-anchor` hz is stable within ~10% run-to-run on the same machine; widen the iteration count if it is not.

## 3. Gate script

- [x] 3.1 Create `scripts/perf-baselines.json` with `_comment`, `defaultTolerance: 1.25`, `recordedFrom` (CI run URL, initially empty), and an empty `benchmarks` object.
- [x] 3.2 Create `scripts/check-perf-budget.mjs` modeled on `scripts/check-bundle-budget.mjs`: read `.bench/results.json`, locate the `noise-anchor` result, and exit 2 with a clear message if it is absent.
- [x] 3.3 Compute each benchmark's cost as `anchorHz / benchHz` and compare against its baseline entry using its `tolerance` or `defaultTolerance`.
- [x] 3.4 Implement the four outcome classes: over tolerance → failure; baselined benchmark missing from results → failure; result with no baseline entry → warning plus the exact JSON line to paste; measured cost more than 25% below baseline → stale-baseline warning.
- [x] 3.5 Print an aligned summary table (benchmark, baseline cost, measured cost, ratio, verdict) and exit 1 if any failure occurred, 0 otherwise.
- [x] 3.6 Support a `--warn-only` flag that reports failures in full but exits 0.
- [x] 3.7 Add `scripts/__tests__/checkPerfBudget.test.ts` covering the four outcome classes against fixture results objects, plus the missing-anchor case, by importing the comparison function rather than shelling out.

## 4. Seed benchmark suites

- [x] 4.1 `src/lib/precision.bench.ts` — repetition scheduling over a fixed grade sequence; inputs built with `seededRandom`.
- [x] 4.2 `src/lib/postpone.bench.ts` — postpone planning across a synthetic collection of ~1000 items.
- [x] 4.3 `src/pages/queueScrollBudget.bench.ts` — queue assembly and budget computation over ~500 items.
- [x] 4.4 `src/utils/markdown.bench.ts` — render a fixed multi-thousand-word document with mixed formatting.
- [x] 4.5 `src/utils/ankiImport.bench.ts` — parse a synthetic deck of ~2000 notes.
- [x] 4.6 `src/lib/file-manifest.bench.ts` — manifest diff/merge over ~1000 entries.
- [x] 4.7 Confirm no suite calls `Math.random()`, reads the clock for input sizing, touches the network or filesystem, or requires a Tauri runtime.

## 5. Retire the misleading timing assertions

- [x] 5.1 Remove the absolute wall-clock `expect(duration).toBeLessThan(...)` assertions from `src/utils/__tests__/wave5Performance.test.ts`, keeping any correctness assertions in those tests.
- [x] 5.2 Add a `src/utils/semanticGrading.bench.ts` covering the AI-grading routing path the removed assertion nominally guarded.
- [x] 5.3 Check `src/utils/__tests__/performance.test.tsx` for the same pattern and remove or convert any absolute-time assertions found.
- [x] 5.4 Update the `test:wave5:performance` npm script if the files it names no longer justify a dedicated script.

## 6. CI wiring

- [x] 6.1 Add a `performance` job to `.github/workflows/ci-regression.yml` with `needs: test`: checkout, `actions/setup-node@v4` with npm cache, `npm install`, `npm run bench`, then `node scripts/check-perf-budget.mjs --warn-only`. No Rust toolchain, no apt packages.
- [x] 6.2 Upload `.bench/results.json` as a workflow artifact so baselines can be recorded from a real CI run.
- [x] 6.3 Merge to `main` in warn-only mode and let CI run.

## 7. Record baselines and enforce

- [x] 7.1 Download `.bench/results.json` from a green `main` run and populate `scripts/perf-baselines.json` with the measured costs, setting `recordedFrom` to that run's URL.
- [x] 7.2 Let `main` run at least a few more times in warn-only mode and check the observed spread; widen `defaultTolerance` or set per-benchmark tolerances if any suite swings past 1.25×.
- [x] 7.3 Drop `--warn-only` from the CI step so the gate enforces.
- [x] 7.4 Verify enforcement end to end: open a throwaway PR that deliberately slows one benchmarked path (e.g. an added inner loop) and confirm the `performance` job fails and names that benchmark.

## 8. Documentation

- [x] 8.1 Document the workflow in `AGENTS.md` (or the contributor docs it points to): how to run `npm run bench:check` locally, how to add a benchmark, and the rule that an intentional performance change updates `scripts/perf-baselines.json` in the same PR.
- [x] 8.2 Add a header comment to `scripts/check-perf-budget.mjs` explaining anchor normalization, matching the explanatory tone of `scripts/check-bundle-budget.mjs`.
