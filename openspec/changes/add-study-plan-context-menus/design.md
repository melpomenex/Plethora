## Context

See proposal.md for motivation and specs/context-menus/spec.md for the behavior contract. The Study Plans components currently expose their actions through direct controls and callbacks, and none of the components in `src/components/study-plans` currently binds an object context menu. The shared `ContextMenu` already provides the application menu store, viewport placement, dismissal, keyboard interaction, and mobile bottom-sheet rendering.

The relevant views already have different state and action boundaries: `PlanOutline` owns topic ordering and removed-topic restore; `PlanNodeEditor` edits and removes/restores/locks topics and manages progress; `PlanSourceList` opens sources and can unlink topic sources; `AssessmentList` opens, archives, and deletes unused assessments; `PlanVersionHistory` conditionally supports viewing and copying a version; and `PlanHomeView` exposes Continue, Browse path, and Review callbacks. The current StudyPlanEditor history view only supplies the active version and a no-op select callback, so it has no actionable alternate-version row today.

## Goals / Non-Goals

**Goals:**

- Expose the existing, object-specific Study Plan actions from right-click menus.
- Keep action availability aligned with the clicked item's state, draft/read-only status, prerequisite ordering, and existing service safeguards.
- Preserve the shared menu's behavior across desktop, keyboard, and mobile shell use.

**Non-Goals:**

- Add new Study Plan persistence, version management, review scheduling, or assessment capabilities.
- Add a menu to blank view backgrounds, editor fields, or unrelated Study Plan screens outside the supplied views.
- Replace existing visible controls or create a second implementation of their behavior.

## Decisions

### Reuse the shared context-menu system

Use the shared menu store and `ContextMenu` component instead of adding a Study Plans-specific overlay. Build items for the object at the point where its state and callbacks are available, then render the shared menu once per menu owner. This keeps placement, one-menu-at-a-time behavior, dismissal, focus handling, and the mobile sheet consistent with the existing app-wide contract.

Alternative considered: add local popovers to each Study Plan component. That would duplicate menu lifecycle and accessibility behavior across the outline, sources, assessments, history, and Plan Home.

### Route menu actions through the existing handlers

Attach row/card context-menu handlers alongside the current click and button handlers. Menu opening only captures the target object identity and pointer location; it must not select the row or trigger its primary action. Choosing an item dispatches the corresponding existing handler or service call. For topic controls that currently live in `PlanNodeEditor`, expose a narrow action callback so the menu and the existing control share the same node update path.

For topic moves, reuse the current topology validation and locked-position behavior; do not calculate a second ordering policy in the menu. Preserve assessment error reporting and reload behavior by dispatching through the same archive/delete handlers. Preserve source navigation through the current `onOpenSource` callback.

Alternative considered: make the context menu a set of links to visible controls. That adds an extra navigation step and fails to make the clicked object's actions directly available.

### Make menus state-aware and omit empty menus

Build items from the clicked object's current state each time the menu opens. Hide actions that do not apply, and disable actions that are temporarily blocked with the existing reason/title mechanism. Use danger styling and the existing deletion safeguards for assessment deletion. Do not open a menu for a version row that has no available view or copy action; in particular, do not invent version-history loading or draft-copy behavior for the current StudyPlanEditor call site, which only supplies one active version and no copy callback.

Alternative considered: render a fixed menu shape for all rows. It would show unusable actions for published plans, removed topics, already-viewing versions, and unavailable source or assessment states.

### Bind menus to objects, not the surrounding surface

Bind context-menu handling to topic rows, source rows, assessment cards, actionable version rows, and the two Plan Home cards. Stop propagation where a row is nested in another interactive surface so a right-click cannot also select or open it. Do not bind the editor inputs, text areas, buttons that manage their own native interaction, or empty background regions.

Alternative considered: attach one handler to the full editor container and infer the object from the event target. This risks showing a stale or nearby object's actions when a user right-clicks a field or blank area.

### Keep Plan Home menus navigational

Expose Continue and Browse path from the recommendation card and Review from the due-review card through their existing callbacks. Do not mark progress or start a session merely because the menu opens. This keeps the recommendation and review queue as separate flows and avoids changing scheduling behavior.

## Risks / Trade-offs

- **A menu action becomes stale while it is open** → capture stable topic/source/assessment/version IDs and re-check current eligibility in the action handler before dispatch.
- **Topic reordering breaks prerequisite order or a lock** → reuse `reorderStudyPlanNode` and show the current constraint reason for unavailable moves.
- **Nested controls also react to a right-click** → stop propagation at the object target and verify that opening the menu does not activate the row's click handler.
- **The version-history view has no available action for its current row** → omit its empty menu; expose menus only if the current view provides a selectable version or a permitted copy-to-draft action.

## Migration Plan

This is a frontend-only change with no persisted-data migration. Rollback consists of removing the Study Plan context-menu bindings and renderers; the existing controls and their handlers remain in place.
