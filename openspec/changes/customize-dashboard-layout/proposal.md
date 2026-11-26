# Change: Customize Dashboard Layout

## Why

The Dashboard currently renders all nine sections and all eight Quick Actions in a fixed order. Different learners prioritize different workflows (for example, jumping straight to Quick Review, Today's Horizon, or Capture Activity, or hiding sections and Quick Action tiles they do not use).

## What Changes

- Add a persistent `useDashboardLayoutStore` (`plethora_dashboard_layout_v1` in `localStorage`) that manages section order, section visibility, Quick Action tile order, and Quick Action visibility, with malformed-data resilience and cross-tab storage synchronization.
- Add an inline **Customize** mode directly on `DashboardTab`, accessible from the Dashboard header (`Customize` button) and the Dashboard surface context menu (`Customize dashboard`).
- In Customize mode, users can reorder Dashboard sections (via pointer drag-and-drop or accessible Move Up / Move Down buttons), toggle section visibility via switches (collapsing hidden sections to compact bars while editing), reorder and toggle individual Quick Action tiles, and reset to the default layout.
- In normal mode, `DashboardTab` renders only visible sections and Quick Actions in the user's configured order, with a recovery empty state if all sections are hidden.

## Impact

- Affected specs: `dashboard-customization`
- Affected code: `src/stores/dashboardLayoutStore.ts`, `src/stores/index.ts`, `src/components/tabs/DashboardTab.tsx`, `src/components/dashboard/DashboardCustomizeBar.tsx`, `src/lib/i18n/locales/*.ts`
