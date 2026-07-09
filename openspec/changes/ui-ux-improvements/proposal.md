## Why

Incrementum exposes a broad set of reading, review, import, and knowledge tools, but several core surfaces give equal visual weight to setup and primary actions. Users need a clearer path from opening the app to completing today’s work, with fewer hidden or competing controls and consistent feedback across desktop and mobile.

## What Changes

- Reframe the dashboard as a focused daily-work surface with a clear next action, workload context, and secondary continuation path.
- Simplify the review home so starting a review is the unambiguous primary action and setup actions are progressively disclosed.
- Improve the tabbed workspace with an open-tab switcher, recent-tab recovery, and clearer active-workspace context.
- Make queue triage actions easy to scan, reversible, and safe to use quickly.
- Introduce shared action, metric, card, focus, and status patterns to make hierarchy and accessibility consistent across core surfaces.
- Add actionable empty states and contextual first-use guidance for key reading, review, and library flows.

## Capabilities

### New Capabilities

- `daily-focus-dashboard`: Present the user’s immediate study and reading priorities with direct next actions.
- `review-workflow-focus`: Prioritize starting a review session while keeping deck, import, and authoring actions available without competing for attention.
- `workspace-navigation`: Help users find, switch, reopen, and understand active tabs in the multi-tab workspace.
- `queue-triage-feedback`: Provide clear, reversible queue item actions and status feedback.
- `core-ui-consistency`: Apply a shared hierarchy, interaction-state, and accessibility standard to core controls and summary surfaces.
- `guided-empty-states`: Explain empty core surfaces and offer a single relevant action to populate them.

### Modified Capabilities

- None.

## Impact

- Affected areas include the dashboard, review home, queue views, document/library views, tab layout, command center, toolbar, mobile navigation, common components, and theme styles.
- The change adds no external service dependencies. It may introduce shared UI primitives and local preference state for workspace recovery.
- Existing routes, persisted documents, queue semantics, review scheduling, shortcut bindings, and import APIs remain compatible.
