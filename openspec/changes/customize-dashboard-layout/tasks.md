## 1. Dashboard Layout Store & OpenSpec
- [x] 1.1 Create `src/stores/dashboardLayoutStore.ts` with `localStorage` persistence, normalization, cross-tab `storage` sync, and section/quick-action reorder & visibility actions.
- [x] 1.2 Export `useDashboardLayoutStore` and types from `src/stores/index.ts`.

## 2. Dashboard Customization UI & i18n
- [x] 2.1 Add localization keys for Dashboard customization across `en.ts`, `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, and `zh.ts`.
- [x] 2.2 Create `src/components/dashboard/DashboardCustomizeSectionFrame.tsx` with accessible drag-and-drop handle, Move Up/Down buttons, visibility `Switch`, and collapsed hidden state.
- [x] 2.3 Integrate Customize mode into `src/components/tabs/DashboardTab.tsx` (header Customize/Reset/Done buttons, surface context menu item, dynamic section rendering, Quick Actions tile customization, and all-hidden recovery state).

## 3. OpenSpec & Regression Tests
- [x] 3.1 Add unit tests in `src/stores/__tests__/dashboardLayoutStore.test.ts` covering defaults, malformed storage, unknown/missing IDs, section/quick-action move/reorder/toggle, reset, and cross-tab sync.
- [x] 3.2 Add component integration tests in `src/components/tabs/__tests__/DashboardCustomization.test.tsx` covering OpenSpec scenarios (header/context-menu entry, Escape exit, section reorder & hide/show, Quick Action hide/reorder, all-hidden recovery, reset to default).
- [x] 3.3 Run Vitest, TypeScript (`tsc`), `impeccable detect`, and `openspec validate customize-dashboard-layout`.
