## Why

Privacy disclosures, AI boundary isolation, end-to-end user workflows, multi-year performance budgets, and product/developer documentation cannot remain unverified after building the ingestion, analytics, and UI layers. A dedicated cross-cutting verification and hardening change ensures every guarantee holds under adversarial, volume, and E2E UI testing.

## What Changes

- Update `src/lib/privacy/disclosureRegistry.ts` (`wearable_health_local`, `wearable_cloud_oauth`, `wearable_encrypted_transfer`) and `docs/PRIVACY_ARCHITECTURE.md` to declare exact health-data storage, network boundaries, and AI non-egress.
- Implement Rust integration & isolation test suite proving health data never enters `plethora.db`, `sync_outbox`, `BackupManager`, `semantic_chunks`, or `MEMORY.md`, and proving 3-year / 100k-sample / 20k-review volume performance stays within latency budgets.
- Add seeded Vitest Sleep Chart transform benchmark (`src/utils/__tests__/sleepChartTransform.bench.ts`) with baseline calibration in `scripts/perf-baselines.json`.
- Build frontend UI workflow tests (`src/components/health/__tests__/`) and Playwright E2E browser verification covering onboarding, manual entry, Sleep Chart, Learning Insights, Study Plan filtering, evidence modal, source priority, disconnect, and complete wipe.
- Author developer guide `docs/architecture/wearable-health-providers.md` and validated canonical product doc `docs/product/features/platform/wearable-health-insights.md`, and regenerate help index (`npm run docs:build-index`).

## Capabilities

### New Capabilities

- `wearable-privacy-and-validation`: Privacy registry disclosures, AI/backup/sync isolation proofs, multi-year volume & benchmark gates, E2E UI verification, and canonical product/developer documentation.

### Modified Capabilities

None.

## Impact

- **Privacy & Docs:** `src/lib/privacy/disclosureRegistry.ts`, `src/lib/privacy/__tests__/__snapshots__/labelMapping.test.ts.snap`, `docs/PRIVACY_ARCHITECTURE.md`, `docs/architecture/wearable-health-providers.md`, `docs/product/features/platform/wearable-health-insights.md`, `src/features/help/generated/`.
- **Tests & Benchmarks:** `src-tauri/tests/health_integration.rs`, `src/utils/__tests__/sleepChartTransform.bench.ts`, `scripts/perf-baselines.json`, `src/components/health/__tests__/*.test.tsx`, `src/e2e/health-insights.spec.ts`.
