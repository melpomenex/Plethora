## Context

`scripts/docs-validate.mjs` enforces 12 YAML frontmatter keys + 4 H2 headings on every file under `docs/product/`. `npm run bench:check` runs every `src/**/*.bench.ts` using `seededRandom(seed)` against `scripts/perf-baselines.json` and checks `scripts/bundle-budgets.json`.

## Goals / Non-Goals

- **Goals:**
  - Machine-verifiable proof that health data never leaks to `plethora.db`, `BackupManager`, `sync_outbox`, `semantic_chunks`, or `llm_chat`.
  - Realistic multi-year volume performance benchmarks in both Rust and Vite/Vitest.
  - Complete Playwright E2E and Vitest workflow tests plus green `docs:validate` and `bench:check`.
- **Non-Goals:**
  - Claiming real-device Apple HealthKit or Android Health Connect hardware test execution when running on a Linux host without Xcode/NDK/physical devices.

## Decisions

### Opt-In Encrypted Transfer Rather Than Implicit E2EE Sync
Keep health records excluded from `plethora.db` E2EE Sync v2 (`sync/registry.rs`) so Apple Guideline 5.1.3(ii) and strict consent scoping cannot be bypassed accidentally; cross-device transfer uses explicit passphrase-encrypted `.plethora-health.enc` bundles with visible policy notice.

### Explicit Unmasked Baseline Reporting
Pre-existing unrelated failures (2 marketing script tests, missing `docs/release/ios-privacy-labels.md` in `labelMapping.test.ts`) are documented rather than patched unrelatedly.
