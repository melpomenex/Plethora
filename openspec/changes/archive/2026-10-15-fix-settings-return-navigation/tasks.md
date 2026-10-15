## 1. Workspace Return Navigation

- [x] 1.1 Add a tab-store query that resolves the most recent valid non-Settings destination and its display title from activation history.
- [x] 1.2 Add an atomic tab-store action that returns to the resolved destination and activates or opens Dashboard when no valid history entry exists.
- [x] 1.3 Add tab-store tests for normal return, repeated Settings activation, closed or invalid targets, Settings exclusion, split-pane targets, and Dashboard fallback.

## 2. Contextual Back Coordination

- [x] 2.1 Add a lightweight contextual-back coordinator that supports registering and unregistering the active Settings hierarchy handler and reports whether an action was consumed.
- [x] 2.2 Update mobile edge-swipe-back completion to dispatch overlay-first, contextual Settings back, workspace history, and fallback behavior without changing gesture thresholds or protected-target handling.
- [x] 2.3 Update native/system-back handling to use the same priority order and prevent default only when an application back action is consumed.
- [x] 2.4 Add coordinator and mobile integration tests for dispatch priority, exactly-once navigation, protected gesture targets, vertical movement, and handler cleanup.

## 3. Settings Controls and Hierarchy

- [x] 3.1 Refactor Settings navigation into a shared guarded action that handles unsaved changes before section-menu and app-return transitions.
- [x] 3.2 Register the compact Settings section/menu hierarchy with the contextual-back coordinator and ensure wide layouts return directly to workspace history.
- [x] 3.3 Add a persistent “Back to {destination}” app-return control to the wide Settings shell, compact Settings menu, and every compact section header while retaining a distinct “Back to Settings menu” control.
- [x] 3.4 Add responsive styling and verify the two compact header actions remain usable at the smallest supported viewport without obscuring section titles or save actions.
- [x] 3.5 Add localized labels and accessible names for destination return, generic fallback return, section-menu back, and Settings exit across every supported locale.

## 4. Verification

- [x] 4.1 Add Settings component tests for persistent control visibility, destination labels, wide and compact hierarchy, keyboard activation, fallback navigation, and direct compact-section exit.
- [x] 4.2 Add Settings component tests proving canceling an unsaved-change prompt preserves the current view and history for button, gesture, and system-back paths, while confirmation completes exactly one transition.
- [x] 4.3 Run the targeted store, Settings, gesture, mobile layout, accessibility, and localization test suites and resolve regressions.
- [x] 4.4 Manually verify return controls and edge/system-back behavior on desktop, a narrow browser/PWA viewport, and the native mobile shell, including entry from several app locations and a restored Settings-only session.
