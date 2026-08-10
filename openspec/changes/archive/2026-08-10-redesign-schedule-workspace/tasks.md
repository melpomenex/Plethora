## 1. Schedule view model and metric semantics

- [x] 1.1 Add focused tests for local calendar-date normalization, due-today/overdue/due-now separation, next-seven-day average, 14-day peak, zero inputs, grouping, and priority ordering.
- [x] 1.2 Implement a pure `scheduleViewModel` module that derives summary insights, presentation-ready forecast days, date groups, selected scope, estimated time, and spread eligibility in bounded passes.
- [x] 1.3 Replace the ad hoc summary/grouping calculations in `ScheduleView`, `ScheduleSummary`, and `ScheduleItemList` with the tested view model while preserving the existing API boundary.
- [x] 1.4 Reconcile the visible workload model after postpone and spread mutations without per-item follow-up requests or a full page reload.

## 2. Shared item presentation and actions

- [x] 2.1 Extract shared schedule-item formatting metadata for item type, due state, interval, stability, difficulty, retrievability, progress, and accessible metric labels; cover edge and missing-value cases with unit tests.
- [x] 2.2 Define one typed action contract for open/study, postpone, suspend, unsuspend, dismiss, and delete, including applicability and per-item busy state.
- [x] 2.3 Build shared `ScheduleItemDetails` and `ScheduleItemActions` components that render complete labeled metrics, tags/category, applicable actions, and keyboard-visible controls.
- [x] 2.4 Extract the portaled context menu to use the shared action contract and verify dismissal, Escape, viewport positioning, and item-type-specific commands.
- [x] 2.5 Migrate Agenda and Data grid item rendering to the shared helpers/components and remove duplicated formatters, detail markup, and duplicate interaction calls.

## 3. Workspace header and workload band

- [x] 3.1 Refactor `ScheduleToolbar` into the workspace header with readable status copy, active-date context, Agenda/Data grid selection, Spread state, and overview-collapse control.
- [x] 3.2 Replace the detached timeline/summary tile layout with one `ScheduleWorkloadBand` containing a compact insight strip and continuous 14-day forecast rail.
- [x] 3.3 Render each forecast day with date, total count, relative magnitude, learning/document composition, today/selected structure, and a complete accessible label that does not rely on color.
- [x] 3.4 Preserve the overview-collapse and desktop view-mode storage keys, render a useful compact collapsed summary, and make invalid persisted values fall back safely.
- [x] 3.5 Make date selection reversible from the rail, All upcoming scope, and active filter control; clear a selected date safely when refreshed data no longer contains it.
- [x] 3.6 Disable or explain Spread when no valid selected/peak source exists and retain the existing `SpreadModal` flow when eligible work is available.

## 4. Dense Agenda mode

- [x] 4.1 Rebuild Agenda as a continuous grouped surface with sticky day headers showing localized date context, item count, and estimated time.
- [x] 4.2 Redesign the item summary row around title/source, due and priority context, estimated time, and compact memory signals; keep details collapsed by default on desktop and mobile.
- [x] 4.3 Expose quick actions on hover and `focus-within`, expose the same actions through expanded detail on touch layouts, and retain explicit disclosure state.
- [x] 4.4 Replace the hand-rolled Agenda offset loop with the installed virtualizer/shared virtual-list pattern using stable keys, overscan, and measured expanded heights.
- [x] 4.5 Verify sticky headers, expansion above/below the viewport, mutation refresh, and date-filter changes do not overlap rows or unexpectedly reset scroll.

## 5. Data grid mode

- [x] 5.1 Restyle the Data grid as a comparison surface with sticky readable headers, a practical title width, aligned tabular values, quiet missing values, and semantic metric states.
- [x] 5.2 Use the shared item details/actions for row expansion, hover/focus quick actions, double-click/open behavior, and context-menu behavior.
- [x] 5.3 Replace fixed-height/manual grid virtualization with measured windowed rows so expanded detail participates in layout and large lists remain bounded.
- [x] 5.4 Contain horizontal scrolling within the grid at intermediate widths and automatically present Agenda in mobile/narrow-only contexts without overwriting the stored desktop preference.

## 6. Responsive, asynchronous, and visual polish

- [x] 6.1 Add shape-matched workload-band and row skeletons that keep the workspace geometry stable while forecast and item data load.
- [x] 6.2 Add distinct empty-schedule, selected-date-no-results, partial-load, and load-error states with localized recovery actions and Retry behavior.
- [x] 6.3 Tune header wrapping, forecast scrolling, content containment, row grids, and at least 44px touch targets for wide desktop, narrow split panes, and mobile safe areas.
- [x] 6.4 Apply the restrained theme-token visual system: one primary accent, danger only for overdue/destructive states, continuous surfaces and separators instead of per-row card chrome, readable working text, and tabular numerals.
- [x] 6.5 Add visible focus/pressed/selected/expanded/disabled states, semantic control labels, color-independent status cues, and reduced-motion fallbacks for every new interaction.
- [x] 6.6 Add all new Schedule copy and accessible labels to English, Chinese, Spanish, Japanese, French, and German locale files and verify long labels can wrap or truncate without losing accessible context.
- [x] 6.7 Remove or repurpose superseded `ScheduleDashboard`, `ScheduleTimeline`, and `ScheduleSummary` markup only after the new workload band covers their behavior.

## 7. Regression and behavior coverage

- [x] 7.1 Add component tests for default/collapsed workspace hierarchy, insight rendering, 14-day selection and clearing, active filter context, and preference restoration.
- [x] 7.2 Add Agenda and Data grid tests for ordering, partial metric data, shared expansion, keyboard access, responsive mode fallback, and applicable item actions.
- [x] 7.3 Add loading, empty, filtered-empty, forecast/item error, Retry, disabled Spread, and mutation reconciliation tests.
- [x] 7.4 Add a 1,000-item rendering regression that asserts Agenda and Data grid mount only visible/overscan rows and preserve measured expansion behavior.
- [x] 7.5 Preserve and run the existing schedule title tests and add regression assertions for flashcard question/cloze titles, document titles, tags, and long localized content in the redesigned rows.

## 8. Verification and visual QA

- [x] 8.1 Run the focused Schedule and i18n Vitest suites and resolve all regressions.
- [x] 8.2 Run `npm run build:check` and resolve TypeScript, Vite, and bundle-budget failures.
- [x] 8.3 Run `npm run bench:check`; if an intentional measured regression is accepted, update `scripts/perf-baselines.json` in the same implementation change with a documented reason.
- [ ] 8.4 Visually verify real dense data in light, dark, and representative custom themes at wide desktop, narrow split-pane, and mobile sizes, including loading, empty, filtered-empty, and error states.
- [ ] 8.5 Walk through date filtering, overview collapse, mode persistence, item expansion, open/study, postpone presets, Spread, context-menu actions, keyboard-only navigation, and reduced-motion behavior before marking the change complete.
