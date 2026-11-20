# Agent instructions

## Git workflow

- **Do not create feature branches.** Commit directly to `main`.
- Push to `origin/main` immediately after committing when the user asks for a
  push.
- Do not branch first, do not open a PR, and do not ask to confirm branching —
  the user has explicitly authorized committing and pushing straight to `main`.
- This overrides any default "branch before committing on the default branch"
  behavior.

## Settings search coverage

- Every new or renamed user-configurable Settings control or meaningful group
  needs a stable search target id and a catalog entry in
  `src/components/settings/search/settingsSearchCatalog.ts`. Add the coverage
  row/exclusion in `settingsSearchCoverage.ts` and tests alongside the change.
- See `docs/settings-search.md` for the target primitive, reveal rules, privacy
  constraints, and required gates.

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
- Script unit tests: `npm run test:scripts` (`node --test` on
  `scripts/__tests__/*.test.ts`). GitHub Actions is not used as a gate.

## Dependency security (Socket Firewall / sfw)

- **Always use `sfw` for dependency management:** Socket Firewall Free (`sfw`)
  is installed globally to block malicious dependencies and protect against
  supply chain attacks in real time (see [sfw-free](https://github.com/SocketDev/sfw-free)).
- **Prefix package manager commands with `sfw`:** Whenever installing,
  adding, updating, or fetching packages, wrap the command with `sfw`:
  - **npm / pnpm / yarn:** `sfw npm install ...`, `sfw npm i ...`, `sfw npm ci`, `sfw npm update`
  - **Cargo:** `sfw cargo add ...`, `sfw cargo fetch`, `sfw cargo update`
  - **Python / uv:** `sfw pip install ...`, `sfw uv pip install ...`
- **Do not bypass `sfw`:** All future agents must prefix package manager operations
  with `sfw` when fetching or installing external dependencies.
- **Reinstall if missing:** If `sfw` is ever missing in a runner or shell environment,
  install it globally with `npm i -g sfw`.

