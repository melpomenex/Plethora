## Why

Schedule entries created from learning items currently lose the context that tells a user what they are studying and may render as an untitled document. The Dashboard and Continue Reading surfaces also display Unix-second timestamps as JavaScript millisecond values, producing misleading ages such as “2947w ago.” Finally, the app can enter a React maximum-update-depth loop (React error #185), taking down the entire UI; these user-facing reliability issues should be corrected together because they affect the same reading and scheduling workflow.

## What Changes

- Give learning-item schedule entries a meaningful display title derived from their parent document and/or learning-item prompt, with a safe fallback for orphaned or malformed records.
- Keep schedule cards, tables, and expanded rows consistent about the item’s document context and learning-item identity.
- Normalize document progress timestamps at the API/display boundary so Unix seconds and JavaScript milliseconds cannot be mixed, then use the corrected relative-time behavior in Dashboard and Continue Reading.
- Fix the split-pane normalization/render effect loop that can repeatedly set state until React error #185 is raised.
- Add regression coverage for title resolution, timestamp conversion/formatting, and rendering with split-pane state.

## Capabilities

### New Capabilities

- `learning-item-context`: Defines how schedule surfaces label learning items and handle missing parent-document data.
- `relative-time-display`: Defines the timestamp unit contract and user-facing relative-time output for reading progress.
- `react-render-stability`: Defines the requirement that persisted pane layouts remain render-stable and do not trigger an update-depth crash.

### Modified Capabilities

<!-- No existing repository-level capability has requirements for these surfaces. -->

## Impact

- Frontend schedule components and queue item mapping in `src/components/schedule/`, `src/components/tabs/DashboardTab.tsx`, and related Continue Reading views.
- Position API/types and the native/browser `get_documents_with_progress` boundary.
- Pane normalization and MainLayout state synchronization in `src/stores/tabsStore.ts` and `src/components/layout/MainLayout.tsx`.
- New frontend unit/component regression tests; no database migration or breaking API change is expected.
