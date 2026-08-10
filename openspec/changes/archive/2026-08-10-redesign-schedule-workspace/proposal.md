## Why

The Schedule view exposes useful forecast and memory data, but its fragmented header, disconnected stat tiles, oversized repeated item cards, tiny metadata, and weak date grouping make the workload difficult to scan or act on. It needs a cohesive, data-rich planning surface that lets users understand pressure, find the items that matter, and reschedule work without sacrificing density, performance, theme support, or mobile usability.

## What Changes

- Replace the stacked toolbar/dashboard/list composition with a unified Schedule workspace whose hierarchy moves from workload status, to the 14-day horizon, to the actionable agenda.
- Replace the disconnected date boxes and stat-card grid with a compact workload band that combines accurate due-now, today, overdue, seven-day average, peak-day, item-type, and estimated-time context.
- Turn card mode into a dense agenda: one continuous surface with sticky day summaries, compact collapsed rows, progressive detail disclosure, and actions that appear on hover, keyboard focus, or expansion instead of consuming permanent space.
- Refine table mode into a legible data grid with sticky headers, clearer metric labels, aligned tabular values, preserved virtualization, and the same detail/action model as the agenda.
- Make date selection and the active view/filter state obvious, reversible, keyboard accessible, and persistent where appropriate.
- Provide polished loading, empty, no-results, and recoverable error states that preserve the shape and context of the workspace.
- Adapt the same information hierarchy for narrow panes and mobile, using touch-sized controls and compact item cards while retaining forecast exploration and schedule actions.
- Keep existing open, study, postpone, spread, suspend, unsuspend, dismiss, delete, localization, theme, and large-queue behaviors; no scheduling-algorithm or backend API change is introduced.

## Capabilities

### New Capabilities

- `schedule-workspace`: Defines the unified workload overview, trustworthy schedule insights, date filtering, agenda and data-grid presentations, progressive item detail/actions, responsive behavior, and complete interaction states.

### Modified Capabilities

None. There is no archived Schedule capability under `openspec/specs/`; this change establishes the current behavior as a new capability while superseding the visual direction of the older unarchived Schedule proposals.

## Impact

- Frontend composition and presentation in `src/components/schedule/`, especially `ScheduleView`, `ScheduleDashboard`, `ScheduleTimeline`, `ScheduleSummary`, `ScheduleToolbar`, `ScheduleItemList`, `ScheduleItemRow`, and `ScheduleTable`.
- Small pure view-model/formatting helpers and frontend tests for schedule insight math, grouping, selection, rendering, keyboard behavior, and action preservation.
- Schedule copy in all supported locale files so the i18n completeness contract remains satisfied.
- Existing `getWorkloadForecast`, `getQueue`, postpone/spread mutations, `ScheduleDayItem`, Tailwind v4 theme tokens, Phosphor icons, and windowed rendering remain the integration boundaries; no new runtime dependency or backend migration is expected.
