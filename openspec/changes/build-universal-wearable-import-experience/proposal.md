## Why

The current Data Sources UI presents three separate buttons (`Import CSV`, `Import JSON`, `Import Apple Health XML`) and shows approval-gated cloud providers as unavailable without guiding users on how to download and import their own wearable exports. Users need a single, discoverable **Import Wearable Data** workflow with automatic provider detection, preview, category selection, CSV column mapping, real-time progress/cancellation, batch history management, and verified **How to export your data** instructions for every provider.

## What Changes

- Build a lazy-loaded **Universal Wearable Import** modal/flow (`UniversalWearableImportDialog.tsx`, `CsvMappingWizard.tsx`, `ExportInstructionsModal.tsx`, `ImportHistorySection.tsx`) using MD3 tokens and existing health dialog patterns.
- Integrate **Import Wearable Data** into Learning Insights → Data Sources, Overview empty state, and Settings → Integrations → Health & Wearables (with Settings Search catalog + coverage updates).
- Surface honest per-provider import readiness separately from cloud OAuth readiness on provider cards, exposing **Import data** and **How to export** actions where genuinely available.
- Support native file picker, drag-and-drop where supported, multi-file selection, automatic detection summary, category toggles, CSV mapping wizard, live progress events with cancellation, completion summary with direct navigation to Sleep Chart / Learning Insights, and import batch deletion.

## Capabilities

### New Capabilities

- `universal-wearable-import-experience`: Unified Import Wearable Data UI, automatic detection display, preview, CSV mapping wizard, progress/cancellation, completion reporting, import history, and provider export instructions.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation`, `implement-secure-health-archive-ingestion`, `implement-primary-wearable-export-importers`, `implement-secondary-wearable-export-importers`, and `expand-apple-health-and-generic-health-imports`.
- **Frontend:** `src/components/health/`, `src/api/health.ts`, `src/types/health.ts`, `src/components/settings/search/settingsSearchCatalog.ts`, `settingsSearchCoverage.ts`.
- **Bundle Budget:** New import wizard components MUST be lazy-loaded (`React.lazy`) so entry bundle budget remains under `scripts/bundle-budgets.json`.
