## Context

Schedule is implemented as a React 19/Tailwind v4 presentation over `getWorkloadForecast(90)` and `getQueue()`, with mutations routed through the existing queue APIs. The current page is modular, virtualized, localized, theme-aware, and functionally rich, but the screenshot and code audit show that the pieces do not form a useful hierarchy:

- `ScheduleToolbar`, `ScheduleDashboard`, `ScheduleTimeline`, and `ScheduleSummary` stack as separate horizontal bands.
- The forecast uses equally weighted colored date boxes while the key status numbers sit in a detached grid of very small stat cards.
- Agenda rows are standalone bordered cards and expand by default on desktop, producing large repeated regions with sparse, tiny metadata.
- Agenda and table duplicate formatting, metric colors, detail markup, action menus, and state behavior, which already allows presentation and interaction drift.
- Several derived values are easy to misread: the current "Due today" selector includes every item due on or before today, and the seven-day average divides the 90-day total by seven.
- The table is dense but relies on abbreviated headers, very small type, hover-only quick actions, and a hand-rolled virtualizer whose fixed row estimates do not include expanded detail.
- Initial failures are logged to the console, so the page can fall through to an empty-looking state with no retry path.

The redesign must work inside the existing desktop shell, narrow split panes, and mobile/PWA layout. It must retain current APIs, mutations, theme selection, all supported locales, and large-queue performance. Tailwind, Phosphor, `@tanstack/react-virtual`, and the existing common components are already available; no additional package is justified.

## Goals / Non-Goals

**Goals:**

- Establish a calm, analytical workspace with a strong top-to-bottom reading order: status, horizon, work.
- Make the view genuinely data rich while keeping primary content readable at a glance.
- Correct and centralize derived schedule semantics so labels and values can be trusted.
- Give Agenda and Data grid modes a shared item model, details, actions, formatting, and accessibility behavior.
- Preserve virtualized performance and make expansion measurements reliable.
- Deliver deliberate responsive, loading, empty, filtered-empty, error, keyboard, reduced-motion, theme, and localization states.
- Keep the refactor incremental and reviewable within `src/components/schedule/`.

**Non-Goals:**

- Changing FSRS, Plethora Adaptive, Plethora Precision, priority, postpone, or spread algorithms.
- Adding new backend commands, database fields, drag-and-drop scheduling, recurring plans, or notification workflows.
- Replacing the application-wide theme or typography system.
- Redesigning the Spread modal beyond any small visual alignment needed to match the new workspace.
- Removing Agenda or Data grid mode, or weakening the item actions already exposed by Schedule.

## Decisions

### 1. Use a three-level workspace instead of a dashboard-card stack

`ScheduleView` remains the data and mutation orchestrator, but its render tree becomes:

```text
ScheduleView
├── ScheduleWorkspaceHeader
│   ├── title + localized workload status
│   ├── active-date chip
│   └── Agenda/Data grid + Spread + overview toggle
├── ScheduleWorkloadBand
│   ├── compact insight strip
│   └── 14-day forecast rail
└── ScheduleContent
    ├── ScheduleAgenda
    └── ScheduleDataGrid
```

The header and workload band form one visually related top region; the content region fills the rest of the pane. The workload band may collapse to a single compact status line, preserving the existing preference.

The visual direction is a restrained "analytical instrument" rather than a collection of mini cards: one background plane, one lightly elevated workload surface, aligned dividers, generous group spacing, and a continuous list surface. Theme `primary` supplies the signature accent; destructive/overdue color is reserved for danger, and item types rely on icon/label/shape before categorical color. Data uses tabular numerals and a readable 12–14px working scale rather than pervasive 9–10px labels. Borders are used for structure, not around every row, and shadows appear only where elevation communicates sticky or floating state.

**Alternative considered:** restyle the existing timeline cells and summary cards in place. This would be lower effort, but it preserves the detached hierarchy and card-within-band visual language that causes the current page to feel scattered.

### 2. Replace filled date tiles with a continuous forecast rail

The 14-day horizon becomes a compact grid/rail. Each day column contains a short weekday/date label, a tabular count, and a magnitude bar. When `due_learning_items` and `due_documents` are available, the bar uses two tonal segments of the same palette and an accessible label provides the exact breakdown. Today, selected day, and overload/danger are expressed with separate structural cues so a full red/green tile is not the only signal.

The All upcoming scope is a compact first segment, not a tile competing visually with dates. On narrow panes the rail scrolls horizontally with snap points and keeps full-size touch targets. Selecting the same date, All upcoming, or the active filter's clear control removes the filter.

**Alternative considered:** a Recharts area or bar chart. A chart is attractive but weaker as a date picker, adds tooltip and responsive complexity, and duplicates a dependency-heavy analytics pattern for a 14-point interaction. Native CSS grid/bars are easier to theme, localize, navigate, and render cheaply.

### 3. Introduce a pure Schedule view model

Add a focused module such as `scheduleViewModel.ts` for date-key normalization, grouping, sort order, metric derivation, scope summaries, and presentation-ready day data. It accepts `ForecastPoint[]`, `ScheduleDayItem[]`, a local calendar date key, and the selected scope; it performs memoizable bounded passes and returns:

- exact `dueToday`, `overdue`, and `dueNow` counts;
- forecast-horizon total, next-seven-day average, and next-14-day peak;
- per-day count, composition, estimated minutes, and relative label inputs;
- all groups and selected-scope groups;
- spread-source eligibility and status copy inputs.

All calendar comparisons operate on normalized date-only keys through `parseScheduleDate`/a companion formatter rather than comparing a UTC timestamp string to local dates. Empty inputs return explicit zero values. Components format localized copy but do not recalculate business semantics.

After a successful schedule mutation, the orchestrator reloads items and reconciles the displayed day/summary model. Spread already reloads the full data set; quick postpones can either patch affected forecast points from the refreshed item set or perform one bounded forecast refresh. The implementation should choose the simpler correct path while avoiding per-item requests.

**Alternative considered:** leave calculations in `ScheduleView` and `ScheduleSummary`. That keeps the file count down but preserves duplicated date semantics, makes the incorrect average easy to reintroduce, and is harder to test without rendering the page.

### 4. Make Agenda a continuous list with progressive disclosure

Agenda replaces standalone, pre-expanded cards with date sections inside one surface:

- A sticky day header shows a prominent relative/absolute date, item count, estimated time, and optional composition.
- A collapsed item summary uses a stable grid: type glyph; title and source/tags; due/priority context; compact memory/time metrics; disclosure/action affordance.
- Secondary metrics and applicable actions appear in one inline detail region when expanded.
- Quick actions appear on row hover and `:focus-within`; touch layouts expose them through expansion. No required action is hover-only.

The first scan should answer: what is it, why is it urgent, how costly is it, and how healthy is its memory state. Detailed algorithm values remain available on the second read. Rows use separators and tonal hover/focus changes rather than a rounded border around each item.

**Alternative considered:** keep desktop rows expanded so every metric is visible. This technically maximizes simultaneous data, but the screenshot demonstrates that it reduces effective density and makes titles, dates, and actions harder to compare.

### 5. Share item presentation and actions across Agenda and Data grid

Extract shared pure formatters and focused components rather than maintaining two copies of schedule-item UI. Candidate boundaries are:

- `scheduleItemPresentation.ts`: type metadata, interval/due formatting, metric severity, accessible labels.
- `ScheduleItemDetails`: labeled memory metrics, progress, tags/category, and open/study action.
- `ScheduleItemActions`: postpone presets and item-type-specific actions with busy state.
- `ScheduleItemContextMenu`: the existing portaled menu behavior with the same action definitions.

Agenda and Data grid own only their summary layout. Both receive the same action contract and render the same details/action components. This also removes duplicated rendering defects and ensures new behavior is testable once.

**Alternative considered:** build a single component with extensive `mode === ...` branches. It saves files initially but creates dense conditional markup and makes responsive/a11y differences harder to reason about.

### 6. Treat Data grid as a comparison tool, not the default visual language

Data grid retains the high-value columns and sticky header, but improves header naming, spacing, alignment, and disclosure. Numeric cells use tabular figures; title keeps a practical minimum width; optional metrics use a quiet em dash; metric severity is communicated with text/icon/accessibility semantics in addition to hue. Quick postpone controls remain available on hover/focus, and the expanded detail uses the shared detail component.

When the pane becomes too narrow, the grid keeps readable column widths inside its own horizontal scroller. At the mobile breakpoint, Schedule renders Agenda even if Data grid is the stored desktop preference; the stored preference is not overwritten.

**Alternative considered:** remove Data grid and make Agenda serve all use cases. That would simplify the page but discard the fastest way for advanced users to compare many scheduling metrics.

### 7. Use the installed virtualizer with measured expansion

Both presentations continue to flatten date headers and item rows into a windowed sequence. Prefer the existing `@tanstack/react-virtual` package or the shared virtual-list pattern over O(n) offset calculation on every scroll. Date headers and collapsed rows receive estimates; mounted entries are measured; an expanded detail is part of the measured entry so following offsets update correctly. Stable keys use the date and item ID, never array position.

Switching date scope scrolls to the beginning intentionally. Expanding a row, opening its context menu, or refreshing an item does not reset the list. The context menu remains portaled so transformed virtualized ancestors cannot change its positioning.

**Alternative considered:** preserve the current hand-rolled card/table virtualizers. They avoid a refactor but duplicate logic, perform repeated offset walks in Agenda, and assume fixed table row heights that do not account for expansion.

### 8. Model responsive layout from pane width and input mode

Use CSS grid/flex wrapping and existing breakpoints so the Schedule pane behaves correctly in split panes, not only when `isMobile` is true. On wide panes, status and actions share the header and the insight strip sits beside/above the forecast rail. On medium panes, the header wraps into two aligned rows and the workload band remains one surface. On narrow/mobile panes, the rail scrolls, the overview uses fewer simultaneous metrics, Data grid is hidden, and Agenda rows become touch-oriented cards/rows with at least 44px controls.

No page-level horizontal overflow is permitted. The Data grid may scroll within its content boundary. Safe-area padding remains on mobile.

### 9. Make asynchronous and accessibility states first-class

Replace the single list-only loading skeleton with a shape-matched shell for the workload band and list. Track forecast and item loading/error states explicitly enough to show partial data when safe and one inline Retry state when the workspace cannot be trusted. Different empty components cover a genuinely empty schedule and a selected date with zero items.

Every button receives visible `focus-visible` styling and an accessible name. Date controls expose selected/current state, disclosure controls expose expansion, mode controls expose pressed state, and icon-only controls have localized labels. Animation is limited to opacity/transform transitions around 160–220ms and disabled or reduced through `prefers-reduced-motion`. Status and magnitude never depend on color alone.

**Alternative considered:** retain console-only load errors and generic skeleton blocks. That is simpler but makes a data-rich planning surface appear untrustworthy whenever one request fails or a filter returns no items.

## Risks / Trade-offs

- **[Risk] Higher visual density becomes overwhelming** → Preserve a strong primary/secondary typographic hierarchy, collapse details by default, limit always-visible metrics, and verify the first-read questions in visual QA.
- **[Risk] Theme variety produces weak contrast or clashing semantic colors** → Use existing semantic/theme tokens, avoid hardcoded dark surfaces, reserve danger color for overdue/destructive states, and test representative light, dark, and high-contrast themes.
- **[Risk] Shared row extraction changes existing actions** → Keep the current handler signatures at the `ScheduleView` boundary and add behavior tests for each applicable item type before removing duplicated components.
- **[Risk] Measured expansion destabilizes virtualization** → Use stable keys, measure the complete header/item entry, test expansion above and below the viewport, and retain overscan.
- **[Risk] Forecast and item requests momentarily disagree after mutation** → Reconcile them through the central view model and refresh/patch the affected forecast once, never through per-item follow-up requests.
- **[Risk] New copy expands in translated locales** → Avoid fixed text widths, use wrapping/truncation only where context remains accessible, update every supported locale, and run the i18n completeness test.
- **[Trade-off] Mobile exposes fewer metrics at once** → Keep the essential due/priority/time signals in the summary and make all other data available through a single tap-accessible detail region.

## Migration Plan

1. Add and test the pure view-model and shared presentation helpers without changing rendered UI.
2. Introduce shared item details/actions and migrate Agenda and Data grid behind their existing props.
3. Replace the toolbar/dashboard shell with the workspace header and workload band while preserving local-storage keys where their meaning is unchanged.
4. Add responsive and state-specific variants, then update localized copy.
5. Run focused Schedule tests, i18n tests, TypeScript/build checks, and `npm run bench:check`; perform visual QA in light/dark themes, desktop, narrow split pane, and mobile.
6. Remove superseded markup/helpers only after both presentation modes and mutations pass regression checks.

Rollback is a normal source revert: there is no persisted-data or backend migration. Existing view-mode and collapsed-overview preference keys remain compatible, so rollback does not require local-storage cleanup.

## Open Questions

No blocking product questions remain. Exact spacing, breakpoint thresholds, and which secondary insight is hidden first on narrow panes should be tuned during implementation against real queue data and representative long translations, without changing the specified information hierarchy.
