# C8-T09 command log (actual executed commands)

- `npm run test:run -- src/test/study-plans-golden/` → unit suites pass (fixtures, harness, golden steps, negative matrix, boundaries, migrations, accessibility)
- `cargo test --lib golden_test_support` (src-tauri) → 1 passed
- `cargo test --lib migration_139` → 2 passed; `cargo test --lib migration_14` → 8 passed
- `cargo test --lib study_` → 31 passed; `cargo test --lib exam_session` → 6 passed; `diagnostic` → 5 passed
- `npm run test:wave5:regression` → 9 files, 46 passed
- `npm run test:scripts` → pass; `npm run docs:validate` → 76 files pass; `npm run check:bundle` → OK 27.2 MB
- `npm run bench:check` → new study-plans benches pass with new baselines; 2 unrelated pre-existing failures (podcastAd cue-regex, haptic-policy-admission) untouched
- `npx tsc --noEmit` → 0 errors in touched files (global pre-existing errors untouched)
- `npx eslint` (scoped) → clean
- `cargo fmt --check` → pass
- `cargo test --lib` (full) → NOT COMPLETED (timeout 120s/600s)
- `openspec validate --all --strict --no-interactive` → 682 passed, 46 failed (all 46 pre-existing unrelated; all 8 program changes except C8 tooling pass — see below)
- `openspec validate <C1..C7> --strict` → Valid for C1–C7 changes
- `openspec validate validate-study-plans-and-examinations-end-to-end --strict` → FAILS (pre-existing tooling: skip_specs not honored; no specs added per design)
- Playwright E2E / physical devices / paid providers → NOT RUN (see evaluation/provider-matrix.md)
