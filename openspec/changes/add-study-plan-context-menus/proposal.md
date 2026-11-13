## Why

Study Plan screens already expose useful actions through buttons and controls, but the topic, source, assessment, version, and daily recommendation objects cannot be acted on from their right-click menus. Adding object-specific menus makes those existing actions easier to discover and reach without changing their underlying behavior.

## What Changes

- Add context menus to curriculum topic rows (including removed topics), source material rows, assessment cards, actionable version history cards, and the Plan Home recommendation and due-review cards.
- Route menu items through the existing Study Plan handlers and services, with actions and availability reflecting the target object's state and the plan's read-only or draft state.
- Preserve the shared context-menu interaction contract, including keyboard and touch presentation, and leave editable fields and blank backgrounds to their existing behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-menus`: Specify the actions and state rules for context menus on Study Plan objects.

## Impact

- Study Plan UI: `PlanOutline`, `PlanNodeEditor`, `PlanSourceList`, `AssessmentList`, `PlanVersionHistory`, and `PlanHomeView`.
- Shared menu UI: `src/components/common/ContextMenu.tsx` and its existing action, dismissal, keyboard, and mobile-sheet behavior.
- No backend, persistence schema, or dependency changes are expected.
