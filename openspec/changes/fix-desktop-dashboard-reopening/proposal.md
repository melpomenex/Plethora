## Why

Desktop users report losing access to the Dashboard after closing their tabs, with a subsequent app launch showing only Queue. The Dashboard must remain reachable from an empty workspace and from a restored session that does not contain it, without requiring a settings reset or another restart.

## What Changes

- Make desktop Dashboard navigation reliably create and activate a canonical Dashboard tab when it is absent, or activate the existing instance when present.
- Keep the empty-workspace Open Dashboard action and desktop toolbar Dashboard action usable after closing tabs.
- Restore a missing desktop Dashboard base tab during startup while preserving restored tabs, split layouts, and the configured Default View focus.
- Cover empty, Queue-only, and legacy closable-Dashboard sessions with regression tests and a desktop close/relaunch check.

## Capabilities

### New Capabilities

- `desktop-dashboard-recovery`: Dashboard reachability, single-instance reopening, and startup recovery for desktop tab workspaces.

### Modified Capabilities

None. The existing `window-state-recovery` capability covers native window geometry/state files rather than tab workspace navigation.

## Impact

- Tab initialization and navigation in `src/components/layout/MainLayout.tsx`.
- Dashboard activation and workspace invariants in `src/stores/tabsStore.ts`, using canonical metadata from `src/components/tabs/TabRegistry.tsx`.
- Existing Dashboard entry points in `src/components/Toolbar.tsx` and `src/components/common/Tabs/Tabs.tsx` where regression evidence identifies a gap.
- Store and layout regression coverage, including `src/stores/__tests__/tabsStore.test.ts` and `src/components/layout/__tests__/MainLayout.defaultView.test.tsx`.
- No new dependencies or persistence schema changes are expected. Mobile behavior and native window-state recovery remain outside this change.
