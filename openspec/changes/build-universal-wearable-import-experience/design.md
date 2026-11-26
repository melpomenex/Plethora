## Context

`DataSourcesPanel.tsx` is shared by both Learning Insights (`DataSourcesPanel`) and Settings (`HealthWearablesSettings.tsx`). `scripts/bundle-budgets.json` enforces strict entry and total dist size limits.

## Goals / Non-Goals

- **Goals:**
  - Single primary **Import Wearable Data** entry point accepting `.zip`, `.xml`, `.csv`, `.json`, and `.plethora-health.enc` (preserving legacy encrypted bundle dialog).
  - Lazy-load `UniversalWearableImportDialog`, `CsvMappingWizard`, and `ExportInstructionsModal` so initial bundle cost is minimal.
  - Subscribe to Tauri `health-import-progress` events for real-time progress and allow cancellation before commit.
  - Update Settings Search (`integrations.health.import_history` / `integrations.health.local`) and `settingsSearchCoverage.ts`.
- **Non-Goals:**
  - Do not hardcode fake counts or advertise unsupported export formats.

## Decisions

- **Progressive Disclosure:** Show detected provider, archive summary, date range, and category checkboxes cleanly; surface warnings, timezone assumptions, and CSV mapping only when relevant.
- **Accessibility & E-ink/Themes:** Use semantic MD3 components (`Button`, `HealthDialog`), keyboard navigation, ARIA live status regions, and CSS variables (`--color-*`) compatible with light, dark, and image-derived themes.
