## 1. Shared UI foundations

- [x] 1.1 Audit the core dashboard, review, queue, documents, toolbar, tabs, and mobile components for duplicate action, metric, card, empty-state, and focus styles.
- [x] 1.2 Create shared action primitives for primary, secondary, tertiary, and destructive actions with accessible disabled and focus states.
- [x] 1.3 Create shared metric and summary primitives that distinguish a primary focus area from secondary analytical information.
- [x] 1.4 Extend the common empty-state component with contextual description, primary action, optional secondary action, and responsive layout support.
- [x] 1.5 Add a reusable accessible action-menu pattern for progressively disclosed controls, including keyboard navigation and focus return.
- [x] 1.6 Document and apply a compact visual token contract for radii, borders, elevation, state colors, and touch targets using the existing theme system.
- [x] 1.7 Add component tests covering action hierarchy, focus visibility, status labels, and empty-state action invocation.

## 2. Daily focus dashboard

- [x] 2.1 Define a dashboard daily-focus view model that derives review, continue-reading, and empty-library recommendations from existing stores and APIs.
- [x] 2.2 Implement deterministic priority selection for due reviews, resumable reading, and first-library-item guidance.
- [x] 2.3 Replace the dashboard header and equal-weight metric grid with a focused daily-action panel and supporting workload context.
- [x] 2.4 Reorganize lifetime metrics, memory statistics, charts, categories, and quick actions into a lower-priority analytical section using the shared summary primitives.
- [x] 2.5 Add loading and error treatments that retain stable dashboard layout and preserve existing analytics error behavior.
- [x] 2.6 Add dashboard tests for each focus recommendation, empty state, loading state, and primary-action navigation.

## 3. Focused review workflow

- [x] 3.1 Recompose Review Home so the start-review action is the sole primary action and displays due count plus estimated session context.
- [x] 3.2 Provide a caught-up state that explains review completion and offers an appropriate next activity without presenting a misleading start action.
- [x] 3.3 Move deck management, import, card creation, refresh, and preview controls into labeled secondary groups or the shared action menu while preserving their behavior.
- [x] 3.4 Verify keyboard, pointer, and touch access to every review setup action and preserve existing shortcuts and modal flows.
- [x] 3.5 Add Review Home tests for due, caught-up, setup-menu, and keyboard-interaction states.

## 4. Workspace navigation and discoverability

- [x] 4.1 Add selectors to `tabsStore` for open-tab metadata, pane context, and recoverable recently closed tabs without changing pane persistence behavior.
- [x] 4.2 Build a searchable workspace switcher that lists open tabs with title, icon, active status, and pane context.
- [x] 4.3 Integrate the workspace switcher with the existing command center and desktop layout using an explicit, discoverable entry point.
- [x] 4.4 Add a recent-tab recovery section that reuses the existing reopen behavior and handles an empty history gracefully.
- [x] 4.5 Adapt the workspace switcher for mobile by using the existing More or modal navigation treatment rather than crowding the bottom navigation.
- [x] 4.6 Extend tabs-store and component tests for filtering, activation in the original pane, reopening, and no-history behavior.

## 5. Queue triage and recovery feedback

- [x] 5.1 Identify the existing primary and secondary queue actions per item type and map them to the shared action hierarchy.
- [x] 5.2 Expose each queue item’s primary action without hover dependence and move lower-frequency actions into the shared accessible action menu.
- [x] 5.3 Add explicit labels and non-color status cues for queue availability, scheduling, and action outcomes.
- [x] 5.4 Add Undo-capable feedback for supported reversible postpone, dismiss, and suspend operations while retaining confirmation for destructive actions.
- [x] 5.5 Revalidate queue state after undo, sync, and failure conditions and provide clear recovery messages when an inverse action cannot complete.
- [x] 5.6 Add queue interaction tests for primary actions, action-menu keyboard use, undo success, undo failure, and existing bulk-action safeguards.

## 6. Guided empty states and surface adoption

- [x] 6.1 Add contextual document-library empty states that direct users to the existing import flow.
- [x] 6.2 Add queue empty states that distinguish filtered, caught-up, and no-content conditions and route users to the appropriate existing flow.
- [x] 6.3 Apply the caught-up review state and dashboard no-content guidance through the shared empty-state primitive.
- [x] 6.4 Update the toolbar and mobile navigation to use the shared action hierarchy and keep essential actions reachable without hover.
- [x] 6.5 Review core desktop and mobile surfaces in light and dark themes for contrast, focus visibility, touch target size, and responsive action overflow.

## 7. Validation and rollout readiness

- [x] 7.1 Run targeted unit and component tests for dashboard, review, tabs, queue, common UI primitives, and empty states.
- [x] 7.2 Run the full type-check, lint, and production build suite and resolve regressions.
- [ ] 7.3 Perform manual desktop and mobile workflow checks for daily focus, review start, tab switching and recovery, queue triage and undo, and empty-state routing.
- [x] 7.4 Verify existing keyboard shortcuts, tab session restoration, route behavior, queue scheduling, imports, and persisted data remain compatible.
- [ ] 7.5 Capture before-and-after screenshots and record remaining follow-up improvements outside this change.
