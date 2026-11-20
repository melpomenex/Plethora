## Tasks

- [x] G-T01 Update `src/lib/privacy/disclosureRegistry.ts`, `labelMapping.test.ts` snapshot, and `docs/PRIVACY_ARCHITECTURE.md` with health vault & OAuth broker disclosures
- [x] G-T02 Write Rust integration tests (`src-tauri/tests/health_integration.rs`) proving AI/backup/sync isolation, token redaction, malicious import defense, deletion cascade, and 3-year/100k-sample/20k-review volume performance
- [x] G-T03 Add Vitest benchmark `src/utils/__tests__/sleepChartTransform.bench.ts` using `seededRandom`, update `scripts/perf-baselines.json`, and verify `npm run bench:check`
- [x] G-T04 Add comprehensive Vitest component/workflow tests (`src/components/health/__tests__/`) and Playwright E2E verification covering the complete §52 user journey, empty/offline/denied/conflict states, themes, and narrow mobile viewport
- [x] G-T05 Write developer provider guide (`docs/architecture/wearable-health-providers.md`) and canonical product doc (`docs/product/features/platform/wearable-health-insights.md`), and verify `npm run docs:validate` + `npm run docs:build-index`
- [ ] G-T06 Execute full final gate suite (`openspec validate` on all 7 changes, `cargo fmt --check`, `cargo test`, `server/` tests, `tsc`, `lint`, `vitest`, `build:check`, `bench:check`, `playwright`) and document results honestly
