## 1. Unified Import UI & Export Guides

- [x] 1.1 Extend `src/types/health.ts` and `src/api/health.ts` with universal import preview, commit, cancel, progress, CSV mapping profile, export guide, and import batch types/commands.
- [x] 1.2 Implement lazy-loaded `UniversalWearableImportDialog.tsx` with file selection, drag-and-drop, detection summary, category selection, preview, progress/cancellation, and completion summary.
- [x] 1.3 Implement `CsvMappingWizard.tsx` for unrecognized CSVs with live normalized record preview and saved mapping profiles.
- [x] 1.4 Implement `ExportInstructionsModal.tsx` and update provider cards in `DataSourcesPanel.tsx` to show truthful file-import vs cloud-sync readiness and actions.
- [x] 1.5 Implement `ImportHistorySection.tsx` for viewing past import batches and deleting a batch safely.
- [x] 1.6 Update `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts` for any new Settings targets and add frontend Vitest tests.
