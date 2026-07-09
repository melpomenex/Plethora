## Context

Incrementum is a React and Tauri productivity application with a tabbed, split-pane workspace and a broad set of reading, review, document, queue, media, and knowledge features. The primary surfaces use Tailwind utility styles and shared Zustand stores, but visual hierarchy and action placement vary by feature. The current dashboard emphasizes metrics, Review Home presents several setup actions alongside the start action, and key actions in dense lists are sometimes only visible on hover.

The implementation must preserve review scheduling, queue state, document data, routes, current shortcuts, tab persistence, translations, desktop use, and mobile behavior. This is an evolution of product interaction patterns, not a brand replacement.

## Goals / Non-Goals

**Goals:**

- Make the most relevant next action immediately apparent on the dashboard, review, queue, and empty states.
- Reduce visual competition by applying a predictable primary, secondary, and overflow action hierarchy.
- Improve navigation and recovery in the existing multi-tab, split-pane workspace.
- Make core interaction states keyboard-accessible, touch-accessible, and understandable without relying on color or hover.
- Deliver the work in independently testable phases without data migrations or feature removals.

**Non-Goals:**

- Replace the existing tabbed workspace, routing model, scheduling algorithms, or data model.
- Redesign every specialist tool in one change.
- Change existing import formats, APIs, or keyboard shortcut bindings.
- Introduce a new third-party component library or a marketing-site visual language.

## Decisions

### Use shared local primitives instead of a new design-system dependency

Create small internal primitives and tokens for action hierarchy, metric presentation, empty states, focus rings, and status messaging. Existing components will adopt them incrementally, beginning with dashboard, review, queue, document library, tabs, toolbar, and mobile navigation.

This keeps the present Tailwind and Phosphor stack, avoids a broad dependency migration, and gives feature code a common contract. A third-party design system was considered, but it would require large-scale visual replacement and would not directly solve Incrementum’s product-specific workflow hierarchy.

### Model daily focus as derived UI state

Build a dashboard view model from existing analytics, queue, review, and reader-position data. The model selects one primary action in priority order: due review, continue reading, then import or browse documents when the library is empty. It also supplies supportive workload context such as count and estimated time.

The decision keeps source-of-truth data in existing stores and APIs. Persisting a separate “daily plan” would create synchronization and timezone complexity without improving the user outcome.

### Progressively disclose setup actions

Review Home will render a single primary session action with visible supporting context. Deck management, import, card authoring, refresh, and other infrequent controls will move into a labeled secondary menu or a compact action group that remains keyboard reachable. The same action hierarchy will govern toolbar and mobile navigation overflow behavior.

Removing the actions entirely was rejected because advanced workflows remain important. Keeping them as equal buttons makes the first-use review path harder to understand.

### Extend the existing tabs store for workspace discovery

Add selectors and UI state on top of `tabsStore` rather than changing its pane model. A workspace switcher will list open tabs with title, icon, location, and active state, offer text filtering, and expose recent closed tabs through the existing `closedTabs` state. The switcher will use the existing Command Center keyboard entry point where appropriate.

Replacing tabs with route-only navigation was rejected because split panes, session restoration, and active-tab history already provide a strong desktop workflow foundation.

### Make queue actions explicit and reversible

Expose the primary action for each queue item directly, with secondary actions in a keyboard-accessible menu. Reversible state changes such as postpone, dismiss, and suspend will show a toast with an Undo action when an inverse operation is available. Destructive actions retain confirmation and existing bulk-action safeguards.

This favors rapid triage without turning the queue into a visually dense dashboard. Color may reinforce state but labels, icons, and messages must communicate the action independently.

### Treat empty states as a product transition

Use a common empty-state pattern with one concise explanation, one primary population action, and optional secondary documentation only where needed. Dashboard, library, queue, and review will select the message from known data conditions rather than display generic “No items” copy.

## Risks / Trade-offs

- [A shared primitive rollout can introduce visual inconsistency during migration] → Convert only the named core surfaces in this change and document the primitive contracts for later adoption.
- [Derived dashboard priorities could feel wrong for some workflows] → Use transparent counts and labels, make each recommendation navigable, and retain direct access to all established surfaces.
- [Queue undo can drift from persisted state after reload or sync] → Limit Undo to reversible operations with a known inverse, invalidate affected queries, and gracefully report when the inverse cannot be completed.
- [Additional workspace UI can add complexity to a dense app] → Reuse the Command Center, keep the switcher searchable, and hide it until explicitly opened.
- [Mobile space is constrained] → Use the same information priority but collapse secondary actions into the existing More menu and preserve touch targets.

## Migration Plan

1. Introduce shared UI primitives and tests without changing stored data or API contracts.
2. Implement each core surface behind its existing routes and tab types, preserving existing fallback actions and shortcuts.
3. Run targeted component and store tests, followed by desktop and mobile visual checks in light and dark themes.
4. Release as a normal UI update. Rollback consists of reverting the UI components because no data migration is required.

## Open Questions

- The default dashboard priority order will be validated with usability testing after implementation. The initial order is due review, continue reading, then library population.
- The exact visual density and breakpoint treatment will follow the existing theme tokens and be reviewed against the current desktop and mobile shells.
