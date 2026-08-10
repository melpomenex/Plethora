# schedule-workspace Specification

## Purpose
Defines the unified Schedule workspace: a primary header with workload status and Agenda/Data grid controls, a workload overview with an interactive 14-day forecast horizon, and a dense agenda or legible data-grid content region with progressive item detail, complete actions, responsive behavior, and full loading/empty/error/accessibility states.

## Requirements
### Requirement: Unified Schedule workspace hierarchy
The system SHALL present Schedule as one coherent workspace with a primary header, a workload overview, and an agenda or data-grid content region. The content region SHALL receive the remaining available height and SHALL NOT repeat page-level controls or date context inside every item.

#### Scenario: Default desktop composition
- **WHEN** a user opens Schedule in a desktop-sized pane
- **THEN** the user sees the current schedule scope and primary actions first, the workload horizon second, and the scheduled items in the remaining space
- **AND** the workload overview and item content read as connected regions rather than independent stacks of cards

#### Scenario: Workload overview is collapsed
- **WHEN** the user collapses the workload overview
- **THEN** the system retains a compact due-now and overdue summary with a control to restore the full overview
- **AND** the item content expands to use the released space

### Requirement: Trustworthy workload insights
The system SHALL derive and label workload metrics consistently: due today SHALL include only items whose calendar due date is today, overdue SHALL include only items before today, due now SHALL equal overdue plus due today, the seven-day average SHALL use only the displayed next seven calendar days, and peak day SHALL use the displayed 14-day horizon. Counts and estimated time SHALL reflect the current visible scope where the label says they are scoped.

#### Scenario: Mixed overdue and upcoming schedule
- **WHEN** the loaded schedule contains overdue items, items due today, and future items
- **THEN** each item contributes to exactly the metric implied by its label
- **AND** the seven-day average is calculated from the sum of the next seven daily totals divided by the number of available days
- **AND** the peak identifies the highest daily total in the displayed 14-day horizon

#### Scenario: No workload for a metric
- **WHEN** a metric has no matching items
- **THEN** the system displays a meaningful zero value without danger emphasis or contradictory copy

### Requirement: Interactive 14-day workload horizon
The workload overview SHALL expose an All upcoming scope and the next 14 calendar days. Each day SHALL show a readable weekday/date label, total due count, relative load magnitude, and learning-item/document composition when available. Date selection SHALL filter the item content and SHALL be reversible.

#### Scenario: User selects a forecast day
- **WHEN** the user activates a day in the workload horizon
- **THEN** that day is visibly identified as the active scope
- **AND** the item content shows only items due on that calendar date
- **AND** the header exposes the active date with a clear action

#### Scenario: User clears a selected day
- **WHEN** the user activates the selected day again, chooses All upcoming, or uses the clear action
- **THEN** the active scope returns to All upcoming
- **AND** all loaded date groups are available in the item content

#### Scenario: Day load is not distinguishable by color alone
- **WHEN** workload magnitude or item composition is visually encoded
- **THEN** the day also exposes text, count, structure, or an accessible label that communicates the same information

### Requirement: Dense agenda presentation
Agenda mode SHALL present scheduled items in a continuous, virtualized list grouped by calendar date. Each group SHALL have a sticky summary containing a relative and/or absolute date, item count, and estimated time when available. Each item SHALL be collapsed by default and SHALL prioritize its title, type/source, due status, priority, time, and memory signals without permanently displaying every action and detail.

#### Scenario: User scans all upcoming work
- **WHEN** Agenda mode contains multiple dates
- **THEN** items are ordered by due date and then by descending priority within each date
- **AND** sticky day summaries preserve date context while scrolling
- **AND** rows use separators and spacing within a shared surface instead of rendering each item as an always-expanded full-width card

#### Scenario: Item has partial scheduling data
- **WHEN** an item lacks one or more optional memory metrics, tags, category, or estimated time
- **THEN** the row omits or substitutes only the unavailable value
- **AND** the remaining title, type, due context, and actions stay aligned and usable

### Requirement: Legible data-grid presentation
On supported pane widths, Data grid mode SHALL provide sticky column headers and aligned tabular values for title, type, priority, due state, interval, repetitions, lapses, difficulty, stability, retrievability, progress, and estimated time. The grid SHALL preserve date grouping, virtualization, item expansion, and row actions, and SHALL use readable labels or accessible descriptions rather than unexplained abbreviations.

#### Scenario: User compares scheduling metrics
- **WHEN** the user selects Data grid mode
- **THEN** the metric columns align across rows and remain associated with sticky headers while scrolling
- **AND** opening item detail does not remove the row's date context or other visible columns

#### Scenario: Grid is wider than its pane
- **WHEN** the available pane cannot display all data-grid columns at a readable width
- **THEN** the grid preserves readable column widths and provides contained horizontal scrolling
- **AND** it does not compress labels and values into illegible text

### Requirement: Progressive item detail and complete actions
Agenda and Data grid rows SHALL share the same item-detail semantics and available actions. Activating an item disclosure SHALL reveal complete memory metrics, tags/category, and applicable actions without navigating away. Existing open/study, postpone, spread, suspend, unsuspend, dismiss, and delete behavior SHALL remain available wherever it applies to the item type.

#### Scenario: User expands an item
- **WHEN** the user activates an item's disclosure control
- **THEN** the system reveals its available stability, difficulty, interval, retrievability, repetition, lapse, progress, category, and tag context with explicit labels
- **AND** the expansion can be closed without losing the active schedule scope

#### Scenario: User invokes a row action
- **WHEN** the user invokes an applicable action from hover controls, keyboard focus, expanded detail, or the context menu
- **THEN** the system exposes a busy state that prevents duplicate submission
- **AND** success or failure feedback remains available through the existing toast behavior
- **AND** the visible items and workload insights reconcile after a successful schedule mutation without a page reload

#### Scenario: Spread has no valid source workload
- **WHEN** no selected day or overloaded horizon day contains eligible items
- **THEN** the Spread action is disabled or explains why it cannot run
- **AND** activating it does not fail silently

### Requirement: Clear and persistent workspace state
The system SHALL expose a clearly selected Agenda/Data grid mode on supported widths and SHALL persist the user's desktop mode and overview-collapse preferences. The active date scope SHALL remain visible until explicitly cleared but SHALL reset safely when the selected date is no longer present after data refresh.

#### Scenario: User returns to Schedule
- **WHEN** a desktop user changes the presentation mode or workload-overview state and later reopens Schedule
- **THEN** the system restores those preferences when they remain valid for the current pane

#### Scenario: Persisted grid mode opens in a narrow pane
- **WHEN** a stored Data grid preference is loaded in a pane that only supports Agenda mode
- **THEN** the system renders the responsive Agenda presentation without discarding the stored desktop preference

### Requirement: Responsive Schedule behavior
The workspace SHALL adapt to the available pane width as well as mobile presentation. Narrow panes SHALL preserve the header status, horizontal workload exploration, date filtering, item detail, and applicable schedule actions without clipped content. Primary touch controls SHALL provide at least a 44 by 44 CSS-pixel target or equivalent spacing.

#### Scenario: Schedule opens on mobile
- **WHEN** Schedule renders in a mobile-sized viewport
- **THEN** the workload horizon remains horizontally explorable
- **AND** scheduled items render as compact Agenda rows/cards with tap-accessible detail and actions
- **AND** the desktop data grid toggle is not presented as an unusable control

#### Scenario: Desktop split pane becomes narrow
- **WHEN** the Schedule pane is resized below the data-grid layout threshold
- **THEN** content reflows without page-level horizontal overflow, action overlap, or loss of active date context

### Requirement: Complete loading, empty, no-results, and error states
The system SHALL provide state-specific Schedule feedback. Loading SHALL use shape-matched placeholders, an empty schedule SHALL explain how scheduled work appears, a selected day with no items SHALL preserve and explain that filter, and a load failure SHALL show an inline error with Retry.

#### Scenario: Initial data is loading
- **WHEN** schedule data has not finished loading
- **THEN** the system renders placeholders matching the workload band and item-row geometry
- **AND** the workspace does not jump through unrelated layouts as data arrives

#### Scenario: Selected date has no items
- **WHEN** the active date scope contains no scheduled items
- **THEN** the system identifies the selected date and provides a clear route back to All upcoming

#### Scenario: Schedule load fails
- **WHEN** forecast or item loading fails
- **THEN** the system retains the Schedule shell, describes the failure inline, and offers Retry

### Requirement: Accessible, theme-aware presentation
All Schedule controls SHALL be operable with pointer, touch, and keyboard; SHALL expose visible focus, selected, expanded, and disabled states; and SHALL use semantic labels for icon-only or abbreviated controls. The workspace SHALL use the existing theme tokens and supported locale system, reserve danger treatment for genuinely overdue or destructive states, and honor reduced-motion preferences.

#### Scenario: Keyboard-only navigation
- **WHEN** a user navigates the Schedule workspace using the keyboard
- **THEN** date cells, view controls, disclosure controls, row actions, and overview controls receive visible focus and activate without requiring hover or a context menu
- **AND** selected and expanded states are programmatically exposed

#### Scenario: Theme or locale changes
- **WHEN** the active theme or supported locale changes
- **THEN** Schedule maintains readable contrast and layout without hardcoded dark-mode assumptions
- **AND** all new user-visible labels and accessible names use localized copy

#### Scenario: Reduced motion is requested
- **WHEN** the operating system requests reduced motion
- **THEN** Schedule avoids nonessential slide, scale, and animated-scroll effects while preserving state feedback

### Requirement: Large-schedule performance
The redesign SHALL retain windowed rendering for both Agenda and Data grid presentations and SHALL avoid introducing per-item network requests or unbounded rendering work. Selecting a date, expanding an item, or switching presentation mode SHALL remain functional with at least 1,000 scheduled items.

#### Scenario: Large queue loads
- **WHEN** Schedule contains 1,000 or more items
- **THEN** only visible and overscan rows are mounted for the active presentation
- **AND** workload insights are derived in bounded passes over the loaded forecast and item data

#### Scenario: User expands a virtualized item
- **WHEN** the user expands or collapses an item in a large virtualized list
- **THEN** row measurement and following offsets update without overlap, lost content, or a jump back to the beginning

