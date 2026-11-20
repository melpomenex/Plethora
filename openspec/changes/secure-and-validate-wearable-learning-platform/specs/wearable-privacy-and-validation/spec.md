## ADDED Requirements

### Requirement: Health data is isolated from backups, library sync, and external AI prompts
The system SHALL isolate all wearable and manual health records in `health.db`, SHALL exclude health records from `BackupManager` cloud backups, `sync_outbox`, `semantic_chunks`, `MEMORY.md`, and default `runTask`/`llm_chat` prompts, and SHALL accurately disclose all health data flows in `DISCLOSURE_REGISTRY` and `docs/PRIVACY_ARCHITECTURE.md`.

#### Scenario: Cloud backup and library sync contain zero health records
- **WHEN** `BackupManager::export_database` and `sync/bootstrap` inspect `plethora.db` after wearable and manual health ingestion
- **THEN** zero health tables or observations appear in the exported database or sync outbox

#### Scenario: Optional AI sharing gate defaults to disabled
- **WHEN** default privacy settings are queried after initialization
- **THEN** `aiSharingEnabled` and `cloudSyncEnabled` are `false` and no health metrics are passed into LLM prompts

### Requirement: Multi-year datasets, full E2E workflows, and product documentation pass automated gates
The system SHALL process 3 years of sleep episodes, 100,000 physiological observations, and 20,000 review records within interactive budgets, SHALL pass Vitest UI and headless browser E2E workflow tests (onboarding, manual log, Sleep Chart, Learning Insights, Study Plan filter, Evidence dialog, disconnect, wipe), and SHALL pass `openspec validate`, `docs:validate`, and `bench:check`.

#### Scenario: 3-year volume dataset runs smoothly end-to-end
- **WHEN** 1,095 nights, 200 naps, 100,000 physiological samples, and 20,000 review results are ingested and analyzed
- **THEN** reconciliation and correlation analytics complete within target latency budgets without OOM or unbounded blocking
