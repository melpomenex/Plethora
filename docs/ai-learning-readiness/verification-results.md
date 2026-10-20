# AI Learning completion — verification results

Recorded on 2026-10-20 in the working tree. Environment: Linux x86_64
container, Node 26.8.1, Rust 1.89. No physical device or native model was
available.

## Passing gates

| Command | Result |
|---|---|
| `npx tsc --noEmit` | pass (exit 0) while the AI Learning changes were the only edits. Later in the session the concurrent recording workstream added files with transient type errors (`sessionTranscriptionPlan.test.ts`, `transcriptionProvider.ts`, `services/recording/*`, `stores/recordingSessionStore.ts`); none are AI Learning files. |
| `npx eslint src --no-cache` | 0 errors (432 pre-existing warnings); repo-wide `npm run lint` also reports pre-existing errors in `.agent` skill scripts and `scripts/` |
| `npx vitest run --testTimeout=20000 --hookTimeout=20000` | 8021 passed, 12 failed, 1 skipped; all 12 failures reproduce at baseline `615570ff` (see §4 of `release-blockers.md`) |
| `npm run build` | pass (Vite, 25.01s) |
| `npm run check:bundle` | pass — entry 5 KB, 1 PDF worker, total 26.5 MB |
| `npm run bench:check` | pass — `[perf-budget] OK — 67 benchmark(s) compared`; bundle budgets OK. New `passageScoring/*` baselines recorded; existing baselines unchanged. |
| `npm run test:scripts` | 3 pre-existing failures (`applyIosProjectOverrides`, docs freshness, macOS `collectEnvironment`); the fourth failure appears only after a web-target `dist` build |
| `node scripts/docs-validate.mjs` | pass — 76 docs, 0 errors |
| `npx playwright test src/visual/ai-diagnostics.visual.spec.ts` | pass (headless Chromium, 17.1 s) — idle → blockers → run/Stop → retry → scoped result → redacted preview/download → reload unknown; no external requests |
| `npm run ai:evidence:validate` | pass — 0 records, every cell pending |
| `openspec validate <change> --strict` for all six changes | pass |
| `cargo check --manifest-path src-tauri/Cargo.toml` | passed earlier in the session (warnings only). A later re-run was OOM-killed while the concurrent recording workstream recompiled heavy Tauri dependencies; the AI Learning Rust edits themselves had already compiled and tested. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 1683 passed, 1 failed, 5 ignored; the failure is the baseline `capture_repository` `is_local_only` test owned by the concurrent recording/privacy migration |
| `cargo fmt --check` on the six touched Rust files | pass after formatting those files; repo-wide fmt fails at baseline too |
| Migration registry order | `123`–`129` re-ordered lexically (passage cache metadata is now `126`); the `test_migration_names_ordered` invariant was replayed from the parsed registry and passes, and `rustfmt` parses the file. The Rust test binary itself could not be rebuilt after the recording workstream's dependency changes exhausted memory. |

## Feature-scoped suites

All green (selected exact invocations):

```sh
npx vitest run src/lib/ai/features
# 4 files, 42 tests

npx vitest run src/lib/ai/__tests__/featureDiagnostics.test.ts \
  src/lib/ai/__tests__/featureSmoke.test.ts \
  src/components/settings/__tests__/AIDiagnosticsModal.test.tsx \
  src/components/settings/__tests__/AIProviderSettings.activation.test.tsx
# diagnostics, smoke, modal and activation tests

npx vitest run src/lib/ai/agent src/lib/ai/assistant \
  src/components/viewer/passageScoring src/api/__tests__/passage-scores.test.ts
# 53 files, 517 tests

npx vitest run src/lib/ai/concepts \
  src/components/viewer/__tests__/SelectionActionsSheet.relationships.test.tsx \
  src/components/graph/__tests__/conceptProjection.test.ts \
  src/api/__tests__/concept-links.test.ts \
  src/lib/ai/schemas/__tests__/conceptRelationship.test.ts
# 9 files, 90 tests

npx vitest run src/components/settings/__tests__/AIProviderSettings.lifecycle.test.tsx
# 2 tests: partial Enable All against real probes, upgraded explicit-false
# preferences, restart re-probe, zero download/index/enqueue side effects

npx vitest run src/lib/__tests__/browserBackendLearningAgent.test.ts
# 6 tests: browser/PWA bounded reads + retry-safe acceptance keys

npx vitest run src/components/viewer/passageScoring \
  src/components/viewer/__tests__/SelectionActionsSheet.test.tsx \
  src/components/media/__tests__
# 15 files, 154 tests (reader controllers/adapters/overlay/cache + actions)
```

Worker C's final knowledge verification additionally recorded 12 files / 134
tests across concepts, schemas, the agent adapter, API wrappers, selection and
graph, plus 13 files / 225 tests for graph and selection-interaction suites;
`cargo test --lib concept_repository` 16 passed and `cargo test --lib
migration_` 24 passed (includes migration 125 and rollback). These are
in-memory/backend tests, not device execution.

## Pending / environment-limited gates

- `npm run bench:memory:check`: not run; it requires launching a built desktop
  app with the memory scenario, which this headless container cannot host.
- `npm run test:visual`: the diagnostics E2E spec passes; the full visual
  screenshot suite is not required by AGENTS.md and was not run end-to-end.
- `cargo clippy --all-targets -- -D warnings`: fails on pre-existing lints in
  unrelated files (`src/lib.rs`, `item_stats.rs`, etc.) as well as baseline
  style lints; not a clean gate at the audited baseline.
- Physical Android/iOS/Windows/macOS qualification and real-provider Linux
  runs: pending, see `release-blockers.md`.
