# Agent instructions

## Git workflow

- **Do not create feature branches.** Commit directly to `main`.
- Push to `origin/main` immediately after committing when the user asks for a
  push.
- Do not branch first, do not open a PR, and do not ask to confirm branching —
  the user has explicitly authorized committing and pushing straight to `main`.
- This overrides any default "branch before committing on the default branch"
  behavior.

## Performance benchmark gate

- **Run locally:** `npm run bench:check` — runs every `src/**/*.bench.ts`
  suite via `vitest bench`, compares the results against
  `scripts/perf-baselines.json` (exit 1 on regression), then runs the bundle
  budget check. A plain `npm run bench` only measures (exit 0, writes
  `.bench/results.json`).
- **Adding a benchmark:** create `src/**/*.bench.ts` with `bench("name", fn)`
  from `vitest`. Build inputs with the seeded PRNG
  `seededRandom(seed)` from `src/test/bench-support.ts` — never
  `Math.random()`, never size inputs from the clock, no network/fs/Tauri
  runtime. Consume the result (e.g. write the fold to a module-level `sink`)
  so the engine cannot elide the loop. Bench bodies must return `void`.
- **How the gate works:** every run includes the `noise-anchor` benchmark
  (`src/anchor.bench.ts`); each benchmark's cost is `anchorHz / benchHz`, a
  dimensionless ratio that survives runner-class differences. Baselines record
  these costs plus a tolerance (default 1.25×).
- **Rule:** an intentional performance change MUST update
  `scripts/perf-baselines.json` in the same PR, saying why in the PR
  description — same protocol as `scripts/bundle-budgets.json`. A result with
  no baseline is only a warning that prints the exact JSON line to paste.
- CI runs the gate in the `performance` job of
  `.github/workflows/ci-regression.yml` (warn-only until baselines are
  recorded from `main` runs, then enforcing); `.bench/results.json` is
  uploaded as the `bench-results` artifact for re-recording baselines.
- Script unit tests: `npm run test:scripts` (`node --test` on
  `scripts/__tests__/*.test.ts`).
